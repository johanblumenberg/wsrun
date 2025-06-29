// scaffold takes:
// * packages -> package.jsons (dependencies, devdependencies, name, scripts)
// *
// scaffold does:
// * creates dir tmp, if exists, rim-raf
// * in tmp, create packages dir and substructure for all packages
// * in each package dir, create package.json and dump dependencies and scripts there.

// spawn takes:
// * command (wsrun etc etc)
// * env var

import * as fs from 'mz/fs'
import { rimraf } from 'rimraf'
import * as cp from 'child_process'
import * as mkdirp from 'mkdirp'
import * as path from 'path'

import { promisify } from 'util'

let mkdirpAsync = promisify(mkdirp)

export type PackageJson = {
  name?: string
  path?: string
  dependencies?: { [name: string]: string }
  devDependencies?: { [name: string]: string }
  scripts?: { [name: string]: string }
}

let counter = process.env['JEST_WORKER_ID'] || '0'

let testDir = `${process.cwd()}/tmp/wsrun-test-${counter}`

export type ScaffoldOptions = {
  packages: PackageJson[]
  workspaces?: any
}

async function realExists(path: string) {
  try {
    return fs.exists(path)
  } catch (e) {
    return false
  }
}

export async function withScaffold(opts: ScaffoldOptions, f: () => PromiseLike<void>) {
  if (await realExists(testDir)) await rimraf(testDir)
  await mkdirpAsync(testDir)
  await fs.writeFile(
    `${testDir}/package.json`,
    JSON.stringify(
      {
        name: test,
        license: 'MIT',
        workspaces: opts.workspaces || {
          packages: ['packages/*']
        }
      },
      null,
      2
    )
  )
  for (let pkg of opts.packages) {
    let pkgPath = pkg.path || `packages/${pkg.name}`
    let fullDir = `${testDir}/${pkgPath}`
    await mkdirpAsync(fullDir)
    await fs.writeFile(`${fullDir}/package.json`, JSON.stringify(pkg, null, 2))
  }
  try {
    return await f()
  } finally {
    if (await realExists(testDir)) await rimraf(testDir)
  }
}

export let echo = {
  makePkg(json: PackageJson, condition: string = '', printthis = '') {
    return Object.assign(json, {
      license: 'MIT',
      scripts: {
        doecho: `sleep $1; echo ${json.name} $1 >> '${testDir}/echo.out'`,
        condition,
        printthis: `echo ${printthis}`
      }
    })
  },
  makePkgErr(json: PackageJson, condition: string = '') {
    return Object.assign(json, {
      license: 'MIT',
      scripts: {
        doecho: `exit 1`
      }
    })
  },
  async getOutput() {
    return fs.readFile(`${testDir}/echo.out`, 'utf8')
  }
}

export function makePkg(name: string, dependencies: { [name: string]: string }, script: string) {
  return {
    name,
    path: `packages/${name}`,
    dependencies,
    license: 'MIT',
    scripts: {
      dorun: script
    }
  }
}

let pkgPath = path.resolve(__dirname, '..')
let binPath = require('../package.json').bin.wsrun
let wsrunPath = path.resolve(pkgPath, binPath)

export async function wsrun(cmd: string | string[], env: { [key: string]: string } = {}) {
  if (typeof cmd === 'string') cmd = cmd.split(' ')
  return cp.spawnSync(wsrunPath, ['--bin=' + require.resolve('./runner.sh')].concat(cmd), {
    cwd: testDir,
    env: { ...process.env, ...env }
  })
}
