require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { NodeSSH } = require('node-ssh');
const commandLineArgs = require('command-line-args');

const optionDefinitions = [
  { name: 'target', type: String, defaultOption: true },
];

const options = commandLineArgs(optionDefinitions);
const ssh = new NodeSSH();

if (!options.target) {
  terminate('--target argument is required!');
}

const targetPath = path.resolve(options.target);
const targetPlatform = options.platform || 'nano328';

if (!fs.existsSync(targetPath)) {
  terminate('Target path does not exist.');
}

if (!process.env.SSH_HOST) {
  terminate('SSH_HOST is required!');
}

if (!process.env.SSH_USER) {
  terminate('SSH_USER is required!');
}

if (!process.env.SSH_USER) {
  terminate('SSH_USER is required!');
}

writeMessage('yellow', 'Connecting to remote host', process.env.SSH_HOST);

const config = {
  host: process.env.SSH_HOST,
  port: process.env.SSH_PORT,
  username: process.env.SSH_USER,
  password: process.env.SSH_PASSWORD,
  privateKey: process.env.SSH_PRIVKEY,
  passphrase: process.env.SSH_PASSPHRASE,
};

ssh.connect(config).then(() => {
  writeMessage('green', 'Successful connection', process.env.SSH_HOST);

  removeRemoteTarget(targetPath)
    .then(() => copyTargetToRemote(targetPath))
    .then(() => buildIno(targetPath, targetPlatform))
    .then(() => uploadIno(targetPath, targetPlatform))
    .then(() => success())
    .catch((err) => terminate(err));
}).catch((err) => {
  terminate('SSH connection error', err);
});

function success() {
  writeMessage('green', 'All done!');
  process.exit(0);
}

function writeMessage(color, ...args) {
  let colorCode = '\x1b[0m';
  switch (color) {
    case 'yellow':
      colorCode = '\x1b[33m';
      break;
    case 'green':
      colorCode = '\x1b[32m';
      break;
    default:
      args.unshift(color);
      break;
  }
  console.log(colorCode, ...args, '\x1b[0m');
}

function writeError(...args) {
  console.error('\x1b[31m', ...args, '\x1b[0m');
}

function terminate(...args) {
  writeError(...args);
  process.exit(1);
}

function buildIno(target, platform) {
  return inoAction('build', target, platform);
}

function uploadIno(target, platform) {
  return inoAction('upload', target, platform);
}

function inoAction(action, target, platform) {
  const baseName = path.basename(target);
  return ssh.exec(
    `ino ${action}`,
    [`-m${platform}`],
    { cwd: `/tmp/${baseName}` },
  ).then((result) => {
    writeMessage(`STDOUT: ${result}`);
    // result.stderr && terminate('inoAction', result.stderr);
    return Promise;
  });
}

function removeRemoteTarget(target) {
  const baseName = path.basename(target);
  if (!baseName) terminate('BaseName error');

  const removePath = `/tmp/${baseName}`;
  writeMessage('yellow', 'Start remove', removePath);

  return ssh.execCommand(
    `rm -r ${removePath} > /dev/null 2>&1`,
  ).then((result) => {
    if (result.stderr) {
      terminate('removeRemoteTarget', result.stderr);
    }

    writeMessage('yellow', removePath, 'removed!', result.stdout);
    return Promise;
  });
}

function copyTargetToRemote(target) {
  const failed = [];
  const successful = [];
  const baseName = path.basename(target);
  const remotePath = `/tmp/${baseName}`;
  writeMessage('yellow', 'Start of transfer from', target, 'to', remotePath);

  return ssh.putDirectory(target, remotePath, {
    recursive: true,
    concurrency: 2,
    validate(itemPath) {
      const itemName = path.basename(itemPath);
      return itemName.substr(0, 1) !== '.' // do not allow dot files
             && itemName !== 'node_modules'; // do not allow node_modules
    },
    tick(localItemPath, remoteItemPath, error) {
      if (error) {
        failed.push(localItemPath);
      } else {
        successful.push(localItemPath);
      }
    },
  }).then((status) => {
    if (status) {
      writeMessage('green', 'The directory transfer was successful');
    }
    if (failed.length) {
      terminate('failed transfers', failed.join(', '));
    }
    if (successful.length) {
      writeMessage('yellow', 'Transfered files:');
      successful.forEach((file) => {
        writeMessage(file);
      });
    }
    return Promise;
  });
}
