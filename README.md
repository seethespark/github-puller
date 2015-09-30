# gitHubPuller
Listen for GitHub changes (Web Hooks) and update the local copy of an application.  This allows a test server to always remain up to date. It is designed for small projects. Originally written to allow lightweight development on a mobile device which then sends to the server running Node.js for testing.

gitHubPuller runs on the edge of your network so that GitHub is able to contact it, on port 7777 by default. When it receives notification of a change it connects to GitHub and downloads the latest version. The downloaded file can be placed on the local machine or placed on a server on the network using sftp.

## Getting started
Create .settings.js (note the leading . making the file hidden). An example is supplied in settings.js.

Update .settings.js with the GitHub hook path and your local server details.
If localPath us not specified then it us ignored.

{name: the path specified in GitHub with leading slash,
    localPath: path on local file system to copy to,
    sftpPath: path on Lan server,
    sftp: {
        username: Lan server username,
        password: Lan server password,
        host: Lan server hostname or IP address,
        }
    };

Make sure the username specified has write access to the server's file system.

It's not finished yet but any feedback would be trementously useful.