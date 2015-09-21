/**
 * Example settings file. Rename to .settings.js for use.
*/
var settings = {};
settings.hooks = [{name: '/gitHub name',
    localPath: '/local path if storing locally',
    sftpPath: '/path on sftp server',
    sftp: {
        username: 'my username',
        password: 'my password',
        host: 'sftp server IP or DNS name',
        }
    }];

module.exports = settings;