import node_ssh from 'node-ssh'
import moment from 'moment'
import fs from 'fs-extra'
import { createInterface, Readline } from 'readline'

const log = console.log.bind(console)

// Linux
export default class SSH {
  constructor(auth, localWorkDir) {
    if (!auth || !localWorkDir) {
      throw new Error('requires auth argument.')
    }
    this.ssh = new node_ssh()
    this.AUTH = Object.freeze(auth)
    this.today = moment().format('YYYYMMDD')
    // the directory where fetched files are put into path below.
    this.localDir = `${localWorkDir}/${this.today}`
    // the directory on remote where it should put used files as production/test in real.
    this.remoteDir = `/home/${this.AUTH.username}/${this.today}`
  }

  async init() {
    try {
      log(`[${this.AUTH.host}][SSH.init] start connecting ${this.AUTH.host}.`)
      await this.ssh.connect(this.AUTH)
      await this.makeBackUpDir()
    } catch (error) {
      throw new Error(`[${this.AUTH.host}]connection ${this.AUTH.host} failed [message: ${error.message}].`)
    } finally {
      log(`[${this.AUTH.host}][SSH.init] finish.`)
    }
  }

  close() {
    this.ssh.dispose()
  }

  async makeBackUpDir() {
    log(`[${this.AUTH.host}][SSH.makeBackUpDir] start making local dir ${this.localDir}`)
    log(`[${this.AUTH.host}][SSH.makeBackUpDir] start making remote dir ${this.remoteDir}`)
    return Promise.all([
      fs.mkdirp(this.localDir),
      this.remoteCommand('mkdir', ['-vp', this.remoteDir]),
    ])
    log(`[${this.AUTH.host}][SSH.makeBackUpDir] finish.`)
  }

  async remoteCommand(cmd, commandParam = []) {
    log(`[${this.AUTH.host}][SSH.remoteCommand] command is "${cmd} ${commandParam.join(' ')}"`)
    return this.ssh.exec(cmd, commandParam, {
      onStderr(chunk) {
        log('stderrChunk', chunk.toString('utf8'))
        throw new Error('occurs command error.')
      },
    })
  }

  async backupRemoteFile(originalPath, filename) {
    const copiedFilePath = `${this.remoteDir}/${filename}`
    log(`[${this.AUTH.host}][SSH.backupRemoteFile] start copy ${originalPath} to ${this.remoteDir}/xxx`)
    await this.remoteCommand(`sudo cp ${originalPath} ${copiedFilePath}`)
    await this.remoteCommand(`sudo chown ${this.AUTH.username}:users ${copiedFilePath}`)
    return copiedFilePath
  }

  async transportFromRemoteToLocal(originalRemoteFilePath) {
    if (originalRemoteFilePath === '*') {
      throw new Error('* can\'t use this time(not implemented).')
    }

    const filename = this.getFilenameFromPath(originalRemoteFilePath)
    const localFilePath = `${this.localDir}/${filename}`

    try {
      // copy original file
      const copiedFilePath = await this.backupRemoteFile(originalRemoteFilePath, filename)

      if (await fs.pathExists(localFilePath)) {
        log(`[${this.AUTH.host}][SSH.transportFromRemoteToLocal] skip ${originalRemoteFilePath}`)
      } else {
        log(`[${this.AUTH.host}][SSH.transportFromRemoteToLocal] ${copiedFilePath} => ${localFilePath}`)
        await this.ssh.getFile(localFilePath, copiedFilePath)
      }
    } catch (error) {
      throw new Error(`downloading remote file failed. [message: ${error.message}]`)
    }
    return localFilePath
  }

  async transportFromLocalToRemote(localFilePath, remotePath, srcHost) {
    const filename = this.getFilenameFromPath(localFilePath)
    const backupRemotePath = `${this.remoteDir}/${filename}`
    log(`[${this.AUTH.host}][SSH.transportFromLocalToRemote] ${localFilePath} => ${backupRemotePath}`)
    await this.ssh.putFile(localFilePath, backupRemotePath)

    const a = `${remotePath}/${filename}.copied_from_${srcHost}`
    await this.remoteCommand(`sudo cp ${backupRemotePath} ${a}`)

    return a
  }

  getFilenameFromPath(path) {
    const tmp = path.split('/')
    const filename = tmp[tmp.length - 1]
    return filename
  }
}

