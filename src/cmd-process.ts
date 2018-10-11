import { ChildProcess, spawn } from 'child_process'

import originalSplit = require('split')

import { defer } from './utils'

export interface CmdOptions {
  rejectOnNonZeroExit: boolean
  silenceErrors?: boolean
  collectLogs: boolean
  prefixer?: (basePath: string, pkg: string, line: string) => string
  doneCriteria?: string
  path: string
}

const SPLIT_OPTIONS = { trailing: false }
const SPLIT_MAPPER = (x: string) => x

const split = () => originalSplit(/\r?\n/, SPLIT_MAPPER, SPLIT_OPTIONS as any)

export class CmdProcess {
  private cp!: ChildProcess
  private _closed = defer<number>()
  private _finished = defer<void>()
  private _exitCode = defer<number>()

  private doneCriteria?: RegExp

  /**
   * Finished will return true even if the process hasn't exited, if doneCriteria was found in
   * the output. Useful for watch processes that have initialization.
   *
   * It will also get rejected if there is a non-favorable exit code.
   */
  get finished() {
    return this._finished.promise
  }

  /**
   * Exitcode is always resolved with the exit code, never rejected.
   */
  get exitCode() {
    return this._exitCode.promise
  }

  /**
   * ExitError is like exitCode, except it gets rejected when the exit code is nonzero
   */
  get exitError() {
    return this.exitCode.then(c => {
      if (c != 0) throw new Error('`' + this.cmdString + '` failed with exit code ' + c)
    })
  }

  get cmdString() {
    return this.cmd.join(' ')
  }

  constructor(private cmd: string[], private pkgName: string, private opts: CmdOptions) {
    this.pkgName = pkgName
    this.opts = opts

    if (this.opts.doneCriteria) this.doneCriteria = new RegExp(this.opts.doneCriteria)
  }

  start() {
    this._start(this.cmd)
    this.cp.once('close', code => {
      this._closed.resolve(code)
      this._exitCode.resolve(code)
    })

    this.cp.once('exit', code => this._exitCode.resolve(code))

    this.exitCode.then(code => {
      if (code > 0) {
        const msg = '`' + this.cmd + '` failed with exit code ' + code
        if (!this.opts.silenceErrors) console.error(msg)
        if (this.opts.rejectOnNonZeroExit) return this._finished.reject(new Error(msg))
      }
      this._finished.resolve()
    })
  }

  stop() {
    this.cp.removeAllListeners('close')
    this.cp.removeAllListeners('exit')
    this.cp.kill('SIGINT')
  }

  private autoPrefix(line: string) {
    return this.opts.prefixer ? this.opts.prefixer(this.opts.path, this.pkgName, line) : line
  }

  private _start(cmd: string[]) {
    let sh: string
    let args: string[]

    // cross platform compatibility
    if (process.platform === 'win32') {
      sh = 'cmd'
      args = ['/c'].concat(cmd)
    } else {
      ;[sh, ...args] = cmd
      //sh = 'bash'
      //shFlag = '-c'
    }

    const stdOutBuffer: string[] = []
    const stdErrBuffer: string[] = []

    this.cmd = cmd
    this.cp = spawn(sh, args, {
      cwd:
        this.opts.path ||
        ((process.versions.node < '8.0.0' ? process.cwd : process.cwd()) as string),
      env: Object.assign(process.env, { FORCE_COLOR: process.stdout.isTTY }),
      stdio:
        this.opts.collectLogs || this.opts.prefixer != null || this.opts.doneCriteria
          ? 'pipe'
          : 'inherit'
    })

    if (this.cp.stdout)
      this.cp.stdout.pipe(split()).on('data', (line: string) => {
        if (this.opts.collectLogs) stdOutBuffer.push(line)
        else console.log(this.autoPrefix(line))
        if (this.doneCriteria && this.doneCriteria.test(line)) this._finished.resolve()
      })
    if (this.cp.stderr)
      this.cp.stderr.pipe(split()).on('data', (line: string) => {
        if (this.opts.collectLogs) stdErrBuffer.push(line)
        else console.error(this.autoPrefix(line))
        if (this.doneCriteria && this.doneCriteria.test(line)) this._finished.resolve()
      })
    if (this.opts.collectLogs)
      this._closed.promise.then(() => {
        console.log(stdOutBuffer.map(line => this.autoPrefix(line)).join('\n'))
        console.error(stdErrBuffer.map(line => this.autoPrefix(line)).join('\n'))
      })
  }
}
