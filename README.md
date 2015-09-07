# gitHubPuller
Listen for GitHub changes (Web Hooks) and update the local copy of an application.  This allows a test server to always remain up to date.

Update settings.js with the GitHub hook path and your local server details.
If localPath is specified then the sftp entries are ignored.

{name: the path specified in GitHub wit leading slash,
    localPath: path on local file system to copy to,
    sftpPath: path on Lan server,
    sftp: {
        username: Lan server username,
        password: Lan server password,
        host: Lan server hostname or IP address,
        }
    }];

It's not finished yet.