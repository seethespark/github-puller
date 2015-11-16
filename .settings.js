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
    },
    {name: '/gitHubPuller',
    secret: 'lorcanvida',
    localPath: 'c:\\nick',
    sftpPath: undefined,
    ssh: {
        username: 'nick1',
        password: 'Whiteln1',
        host: 'localhost',
        port: 22,
        }
    }];


module.exports = settings;