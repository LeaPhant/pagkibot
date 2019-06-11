const config = {
    debug: true,
    prefix: "!",
    allowDM: true,
    setAvatar: true,
    avatarPath: "./res/avatar.png",
    commands: {
        twitchTrack: {
            enabled: true,
            cmd: ["twitch-track"],
            perms: ["ADMINISTRATOR"]
        },
        
        twitchUntrack: {
            enabled: true,
            cmd: ["twitch-untrack"],
            perms: ["ADMINISTRATOR"]
        },
        
        twitchRedirect: {
            enabled: true,
            cmd: ["twitch-redirect"],
            perms: ["ADMINISTRATOR"]
        },
        
        twitchTracking: {
            enabled: true,
            cmd: ["twitch-tracking"],
            perms: []
        },
        
        twitchNotify: {
            enabled: true,
            cmd: ["twitch-notify"],
            perms: []
        },
        
        twitchUnnotify: {
            enabled: true,
            cmd: ["twitch-unnotify"],
            perms: []
        },
        
        twitchEveryone: {
            enabled: true,
            cmd: ["twitch-everyone"],
            perms: ["ADMINISTRATOR"]
        },
        
        twitchHere: {
            enabled: true,
            cmd: ["twitch-here"],
            perms: ["ADMINISTRATOR"]
        },
        
        pagkibot: {
            enabled: true,
            cmd: ["pagkibot"],
            perms: []
        }
    }
};

let custom_config = {};

const fse = require('fs-extra');
const path = require('path');
const objectPath = require('object-path');

const moment = require('moment');
require("moment-duration-format");

module.exports = {
    default_config: config,
    log: (...params) => {
        console.log(`[${moment().toISOString()}]`, ...params);
        
    },
    
    error: (...params) => {
        console.error(`[${moment().toISOString()}]`, ...params);
        
    },
    
    getOption: (...path) => {
        return objectPath.get(custom_config, path) || objectPath.get(config, path);
    },
    
    saveJSON: (name, object) => {
        fse.outputFileSync(path.resolve(__dirname, 'data', `${name}.json`), JSON.stringify(object, null, 2));
    },
    
    loadJSON: (name) => {
        let json;
        
        try{
            json = JSON.parse(fse.readFileSync(path.resolve(__dirname, 'data', `${name}.json`)));
        }catch(e){
            json = { };
        }
        
        return json;
    },
    
    checkCommand: (msg, command) => {
        if(!command.enabled)
            return false;
        
        if(!msg.content.startsWith(module.exports.getOption('prefix')))
            return false;
        
        if(msg.channel.type == 'text' && !msg.member.hasPermission(command.perms))
            return false;
        
        if(msg.channel.type != 'text' && !module.exports.getOption('allowDM'))
            return false;
        
        let msg_check = msg.content.toLowerCase().substr(module.exports.getOption('prefix').length).trim();
        
        if(!Array.isArray(command.cmd))
            command.cmd = [command.cmd];
        
        for(let i = 0; i < command.cmd.length; i++){
            let command_check = command.cmd[i].toLowerCase().trim();
            
            if(msg_check.startsWith(command_check + ' ') || msg_check == command_check)
                return true;
                
        }
        
        return false;
    },
    
    formatTwitchEmbed: channel => {
        let return_obj = {
            color: 6570404,
            author: {
                icon_url: "https://cdn.discordapp.com/attachments/572429763700981780/572429816851202059/GlitchBadge_Purple_64px.png",
                url: `https://twitch.tv/${channel.username}`,
                name: `${channel.display_name} is now live!`
            },
            title: channel.status,
            url: `https://twitch.tv/${channel.username}`,
            description: `**Game**: ${channel.game}\n**Viewers**: ${channel.viewers}`,
            thumbnail: {
                url: channel.avatar
            },
            footer: {
                text: `Live for ${moment.duration(Math.max(0, moment().unix() - channel.start_date), "seconds").format("h [hour and] m [minute]")}`
            }
        };
        
        if(!channel.live){
            return_obj.footer.text = `Stream length: ${moment.duration(Math.max(0, channel.end_date - channel.start_date), "seconds").format("h [hour and] m [minute]")}`;
            return_obj.author.name = `${channel.display_name} was streaming`;
            return_obj.description = `**Game**: ${channel.game}\n**Peak Viewers**: ${channel.peak_viewers}`;
        }
        
        return return_obj;
    },
    
    discordErrorHandler: err => {
        if(module.exports.getOption('debug'))
            module.exports.error(err);
        else if('message' in err)
            module.exports.error(err.message);
    }
};

if(fse.existsSync('./config.json')){
    try{
        custom_config = JSON.parse(fse.readFileSync('./config.json'), 'utf8');
    }catch(e){
        module.exports.error('malformatted config.json, exiting...');
        process.exit(1);
    }
}
