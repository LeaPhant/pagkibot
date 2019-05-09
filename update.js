const pkg = require('./package.json');
const config_old = require('./config.json');
const credentials = require('./credentials.json');

const repo = pkg.repository.url.split("+").pop();
const fse = require('fs-extra');
const git = require('nodegit');
const nestedAssign = require('nested-object-assign');
const axios = require('axios');

let avatarContent;

if(fse.existsSync(config_old.avatarPath))
    avatarContent = fse.readFileSync(config_old.avatarPath);

const local_version = Number(pkg.version.replace(/\./g,''));

axios.get('https://raw.githubusercontent.com/LeaPhant/pagkibot/master/package.json').then(response => {
    const version = Number(response.data.version.replace(/\./g,''));
    
    if(local_version >= version){
        console.log('Your version is already up-to-date!');
        process.exit(1);
        
    }
    
    console.log('Downloading new version...');
    
    fse.emptyDirSync('.');

    git.Clone(repo, ".").then( () => {
        const config = require('./config.json');
        
        let config_new = {};
        
        nestedAssign(config_new, config, config_old);
        fse.writeFileSync('./config.json', JSON.stringify(config_new, false, 2));
        fse.writeFileSync('./credentials.json', JSON.stringify(credentials, false, 2));
        
        if(avatarContent)
            fse.outputFileSync(config_old.avatarPath, avatarContent);
        
    }).catch(console.error);
    
}).catch(console.error);
