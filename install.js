const fse = require('fs-extra');
const helper = require('./helper');
const nestedAssign = require('nested-object-assign');
const deepForEach = require('deep-for-each');
const objectPath = require('object-path');

const stringify = require('json-stable-stringify');

const { default_config } = helper;

let custom_config = {};

const default_credentials = {
    twitch: {
        clientID: ""
    },
    discord: {
        clientID: "",
        token: ""
    }
}

let custom_credentials = {};

function compare(a, b){
	return a.key == "commands" ? 1 : a.key > b.key;
}
 
if(fse.existsSync('./config.json')){
    try{
        custom_config = JSON.parse(fse.readFileSync('./config.json'), 'utf8');
    }catch(e){
        module.exports.error('malformatted config.json, exiting...');
        process.exit(1);
    }
}

let output_config = {};

nestedAssign(output_config, custom_config, default_config);

deepForEach(output_config, (value, key, subject, path) => {
    if(Array.isArray(value))
        objectPath.set(output_config, path, [...new Set(value)]);
});

fse.writeFileSync('./config.json', stringify(output_config, { cmp: compare, space: 2 }));


if(fse.existsSync('./credentials.json')){
    try{
        custom_credentials = JSON.parse(fse.readFileSync('./credentials.json'), 'utf8');
    }catch(e){
        module.exports.error('malformatted credentials.json, exiting...');
        process.exit(1);
    }
}

let output_credentials = {};

nestedAssign(output_credentials, custom_credentials, default_credentials);

fse.writeFileSync('./credentials.json', stringify(output_credentials, { space: 2 }));

console.log('Configuration files successfully generated');
