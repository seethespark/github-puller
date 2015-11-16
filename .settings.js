var settings = {};
settings.hooks = [{name: '/nickwhiteley',
	secret: 'lorcanvida',
    localPath: 'c:\\nick',
    sftpPath: '/var/www',
    ssh: {
        username: 'nick1',
        password: 'Whiteln1',
        host: 'localhost',
        port: 22,
        }
    }];

settings.gitIPs = ['192.30.252.41', '192.30.252.45', '192.30.252.42', '192.30.252.46']

module.exports = settings;