const credentials = require('./credentials.json');
const config = require('./config.json');
const helper = require('./helper');

if(credentials.twitch.clientID.length == 0)
    throw "Please set a Twitch Client ID first. Check https://dev.twitch.tv/console/apps/create to register your application.";

if(credentials.discord.clientID.length == 0)
    throw "Please set a Discord Client ID first. Check https://discordapp.com/developers/applications/ to register your application and get your Client ID.";

if(credentials.discord.token.length == 0)
    throw "Please set a Discord Bot Token first. Check https://discordapp.com/developers/applications/ to register your application and create a bot.";

let trackedChannels = helper.loadJSON('trackedChannels');
let redirectChannels = helper.loadJSON('redirectChannels');
let dataStore = helper.loadJSON('dataStore');

const SOCKET_COUNT = 10;
const MAX_TOPICS = 50;

let open_sockets = 0;
let sockets = [];

const fse = require('fs-extra');
const crypto = require('crypto');
const axios = require('axios');
const WebSocket = require('ws');
const Discord = require('discord.js');
const moment = require('moment');

require("moment-duration-format");

const helixApi = axios.create({
    baseURL: 'https://api.twitch.tv/helix/',
    headers: { 'Client-ID': credentials.twitch.clientID }
    
});

const krakenApi = axios.create({
    baseURL: 'https://api.twitch.tv/kraken/',
    headers: { 'Client-ID': credentials.twitch.clientID }
    
});

const client = new Discord.Client();

client.once('ready', () => {
    helper.log(`Invite bot to server: https://discordapp.com/api/oauth2/authorize?client_id=${credentials.discord.clientID}&permissions=0&scope=bot`);
    
    let avatar_md5 = crypto.createHash('md5').update(fse.readFileSync(config.avatarPath)).digest("hex");
    
    if(dataStore.avatarSet == avatar_md5)
        return false;
    
    if(config.debug)
        helper.log('avatar file has changed, updating');
    
    client.user.setAvatar(config.avatarPath)
    .then(() => {
        dataStore.avatarSet = avatar_md5
        helper.saveJSON('dataStore', dataStore);
        
        if(config.debug)
            helper.log('avatar updated');
        
    }).catch(helper.discordErrorHandler);
    
});

client.on('message', onMessage);

client.login(credentials.discord.token);

function onMessage(msg){
    let argv = msg.content.split(' ');
    
    if(helper.checkCommand(msg, config.commands.twitchTrack)){
        if(argv.length == 2){
            let username = argv[1];
            
            helixApi.get(`users?login=${username}`).then(response => {
                let data = response.data.data;
                
                if(data.length == 0){
                    msg.channel.send(`Twitch user \`${username}\` not found!`)
                    .catch(helper.discordErrorHandler);
                    
                    return false;
                    
                }
                
                let twitchUser = data[0];
                
                let id = twitchUser.id;
                
                if(!(id in trackedChannels)){
                    trackedChannels[id] = {
                        username: twitchUser.login,
                        display_name: twitchUser.display_name,
                        viewers: 0,
                        live: false,
                        game: "",
                        status: "",
                        avatar: twitchUser.profile_image_url,
                        channels: {},
                        dm_channels: {}
                    };
                    
                    if(!trackTwitchUser(id, trackedChannels[id])){
                        msg.channel.send(`Maximum amount of tracked twitch channels reached :(`)
                        .catch(helper.discordErrorHandler);
                        
                        return false;
                        
                    }
                    
                }
                
                if(msg.channel.type == 'dm' && config.allowDM){
                    if(!(msg.author.id in trackedChannels[id].dm_channels)){
                        trackedChannels[id].dm_channels[msg.author.id] = {};
                        helper.saveJSON('trackedChannels', trackedChannels);
                        msg.channel.send(`Now tracking \`${username}\``)
                        .catch(helper.discordErrorHandler);
                        
                    }else{
                        msg.channel.send(`Already tracking \`${username}\`!`)
                        .catch(helper.discordErrorHandler);
                            
                        return false;
                        
                    }
                    
                }else{
                    if(!(msg.channel.id in trackedChannels[id].channels)){
                        trackedChannels[id].channels[msg.channel.id] = {notifies: []};
                        helper.saveJSON('trackedChannels', trackedChannels);
                        msg.channel.send(`Now tracking \`${username}\``)
                        .catch(helper.discordErrorHandler);
                        
                    }else{
                        msg.channel.send(`Already tracking \`${username}\`!`)
                        .catch(helper.discordErrorHandler);
                        
                        return false;
                        
                    }
                    
                }
                
                let requests = [
                    krakenApi.get(`channels/${username}`),
                    krakenApi.get(`streams/${username}`)              
                ];
                
                Promise.all(requests).then(data => {
                    let twitchChannel = data[0].data;
                    
                    trackedChannels[id].game = twitchChannel.game;
                    trackedChannels[id].status = twitchChannel.status;
                    
                    let twitchStream = data[1].data.stream;
                    
                    if(twitchStream !== null){
                        trackedChannels[id].live = true;
                        trackedChannels[id].viewers = twitchStream.viewers;
                        trackedChannels[id].peak_viewers = twitchStream.viewers;
                        trackedChannels[id].start_date = moment(twitchStream.created_at).unix();
                        
                        let channel = msg.channel;
                        
                        if(msg.channel.id in redirectChannels)
                            channel = client.channels.get(redirectChannels[msg.channel.id]);
                        
                        channel.send({embed: helper.formatTwitchEmbed(trackedChannels[id])}).then(_msg => {
                            if(msg.channel.type == 'dm'){
                                trackedChannels[id].dm_channels[msg.author.id].msg_id = _msg.id;
                                
                            }else{
                                if(config.debug)
                                    helper.log(`live message posted in ${msg.channel.id}, has msg_id ${_msg.id}`);
                                
                                trackedChannels[id].channels[msg.channel.id].msg_id = _msg.id;
                                
                            }
                            
                            helper.saveJSON('trackedChannels', trackedChannels);
                            
                        }).catch(helper.discordErrorHandler);
                        
                    }
                    
                    helper.saveJSON('trackedChannels', trackedChannels);
                    
                }).catch(helper.error);
                
            }).catch(helper.error);
            
        }else{
            msg.channel.send(`usage: \`${config.prefix}${config.commands.twitchTrack.cmd[0]} <twitch username>\``)
            .catch(helper.discordErrorHandler);
            
        }
    }
    
    if(helper.checkCommand(msg, config.commands.twitchUntrack)){
        if(argv.length != 2){
            msg.channel.send(`usage: \`${config.prefix}${config.commands.twitchUntrack.cmd[0]} <twitch username>\``)
            .catch(helper.discordErrorHandler);
                
            return false;
            
        }
        
        let username = argv[1];
        
        if(config.debug)
            helper.log(`fetching ${username}`);
        
        helixApi.get(`users?login=${username}`).then(response => {
            let data = response.data.data;
                
            if(data.length == 0){
                msg.channel.send(`Twitch user \`${username}\` not found!`)
                .catch(helper.discordErrorHandler);
                
                return false;
                
            }
            
            let twitchUser = data[0];
            
            let id = twitchUser.id;
            
            if(id in trackedChannels){
                if(msg.channel.type == 'dm'){
                    if(msg.author.id in trackedChannels[id].dm_channels){
                        untrackTwitchUser(id, msg.author.id, 'dm', trackedChannels[id]);
                        msg.channel.send(`Stopped tracking \`${username}\``)
                        .catch(helper.discordErrorHandler);
                        
                    }else{
                        msg.channel.send(`\`${username}\` is not being tracked!`)
                        .catch(helper.discordErrorHandler);
                        
                    }
                    
                }else{
                    if(msg.channel.id in trackedChannels[id].channels){
                        untrackTwitchUser(id, msg.channel.id, 'text', trackedChannels[id]);
                        msg.channel.send(`Stopped tracking \`${username}\``)
                        .catch(helper.discordErrorHandler);
                        
                    }else{
                        msg.channel.send(`\`${username}\` is not being tracked!`)
                        .catch(helper.discordErrorHandler);
                        
                    }
                    
                }
                
            }else{
                msg.channel.send(`\`${username}\` is not being tracked!`)
                .catch(helper.discordErrorHandler);
                
            }
            
        }).catch(helper.error);
        
    }
    
    if(helper.checkCommand(msg, config.commands.twitchRedirect)){
        if(msg.channel.type != 'text')
            return false;
        
        if(argv.length != 2){
            msg.channel.send(`usage: \`${config.prefix}${config.commands.twitchRedirect.cmd[0]} <discord channel mention>\``);
            return false;
            
        }
        
        try{
            let channel_id = argv[1].split('#').pop().split('>')[0];
            let output_channel = msg.guild.channels.get(channel_id);
            
            if(output_channel){
                if(config.debug)
                    helper.log(`setting redirect channel to ${channel_id}`);
                
                redirectChannels[msg.channel.id] = channel_id;
                helper.saveJSON('redirectChannels', redirectChannels);
                msg.channel.send(`Set redirect channel for stream announcements to <#${channel_id}>`)
                .catch(helper.discordErrorHandler);
                
            }else{
                msg.channel.send('Mentioned channel not found!')
                .catch(helper.discordErrorHandler);
                
            }
            
        }catch(e){
            msg.channel.send(`usage: \`${config.prefix}${config.commands.twitchRedirect.cmd[0]} <discord channel mention>\``)
            .catch(helper.discordErrorHandler);
            
        }
        
    }
    
    if(helper.checkCommand(msg, config.commands.twitchNotify)){
        if(msg.channel.type != 'text')
            return false;
        
        if(argv.length != 2){
            msg.channel.send(`usage: \`${config.prefix}${config.commands.twitchNotify.cmd[0]} <twitch username>\``)
            .catch(helper.discordErrorHandler);
            
            return false;
            
        }
        
        let username = argv[1];
        
        if(config.debug)
            helper.log('fetching', username);
        
        helixApi.get(`users?login=${username}`).then(response => {
            let data = response.data.data;
                
            if(data.length == 0){
                msg.channel.send(`Twitch user \`${username}\` not found!`)
                .catch(helper.discordErrorHandler);
                
                return false;
                
            }
            
            let twitchUser = data[0];
            let id = twitchUser.id;
            
            if(!(id in trackedChannels)){
                msg.channel.send(`\`${username}\` is not being tracked!`)
                .catch(helper.discordErrorHandler);
                
                return false;
                
            }
            
            if(!(msg.channel.id in trackedChannels[id].channels)){
                msg.channel.send(`\`${username}\` is not being tracked!`)
                .catch(helper.discordErrorHandler);
                
                return false;
                
            }
            
            let channel = trackedChannels[id].channels[msg.channel.id];
            
            if(channel.notifies.includes(`<@${msg.author.id}>`)){
                msg.channel.send(`You are already being notified when \`${username}\` is streaming!`)
                .catch(helper.discordErrorHandler);
                
                return false;
                
            }
            
            channel.notifies.push(`<@${msg.author.id}>`);
            helper.saveJSON("trackedChannels", trackedChannels);
            
            msg.channel.send(`You are now being notified when \`${username}\` is streaming`)
            .catch(helper.discordErrorHandler);
            
        }).catch(helper.error);
    }
    
    if(helper.checkCommand(msg, config.commands.twitchUnnotify)){
        if(msg.channel.type != 'text')
            return false;
        
        if(argv.length != 2){
            msg.channel.send(`usage: \`${config.prefix}${config.commands.twitchUnnotify.cmd[0]} <twitch username>\``)
            .catch(helper.discordErrorHandler);
            
            return false;
            
        }
        
        let username = argv[1];
        
        if(config.debug)
            helper.log('fetching', username);
        
        helixApi.get(`users?login=${username}`).then(response => {
            let data = response.data.data;
                
            if(data.length == 0){
                msg.channel.send(`Twitch user \`${username}\` not found!`)
                .catch(helper.discordErrorHandler);
                
                return false;
                
            }
            
            let twitchUser = data[0];
            let id = twitchUser.id;
            
            if(!(id in trackedChannels)){
                msg.channel.send(`\`${username}\` is not being tracked!`)
                .catch(helper.discordErrorHandler);
                
                return false;
                
            }
            
            if(!(msg.channel.id in trackedChannels[id].channels)){
                msg.channel.send(`\`${username}\` is not being tracked!`)
                .catch(helper.discordErrorHandler);
                
                return false;
                
            }
            
            let channel = trackedChannels[id].channels[msg.channel.id];
            
            if(!(channel.notifies.includes(`<@${msg.author.id}>`))){
                msg.channel.send(`You are not being notified when \`${username}\` is streaming!`)
                .catch(helper.discordErrorHandler);
                
                return false;
                
            }
            
            channel.notifies = channel.notifies.filter(a => a != `<@${msg.author.id}>`);
            helper.saveJSON("trackedChannels", trackedChannels);
            
            msg.channel.send(`You are no longer being notified when \`${username}\` is streaming`)
            .catch(helper.discordErrorHandler);
            
        }).catch(helper.error);
        
    }
    
    if(helper.checkCommand(msg, config.commands.twitchTracking)){
        let tracked = [];
        
        for(id in trackedChannels){
            if(msg.channel.type == 'dm' && config.allowDM){
                if(msg.author.id in trackedChannels[id].dm_channels)
                    tracked.push(trackedChannels[id]);
                
            }else{
                if(msg.channel.id in trackedChannels[id].channels)
                    tracked.push(trackedChannels[id]);
                
            }
            
        }
        
        if(tracked.length == 0){
            msg.channel.send("This channel doesn't have any tracked channels yet!");
            return false;
            
        }
        
        let embed = {
            color: 6570404,
            description: 'Tracked Twitch streams in this channel:',
            author: {
                icon_url: "https://cdn.discordapp.com/attachments/572429763700981780/572429816851202059/GlitchBadge_Purple_64px.png",
                name: `Twitch Tracking`
            },
            fields: [
                {
                    name: '⠀',
                    value: '',
                    inline: true
                },
                {
                    name: '⠀',
                    value: '',
                    inline: true
                },
                {
                    name: '⠀',
                    value: '',
                    inline: true
                }
            ]
        };
        
        let field_index = 0;
        
        tracked.forEach((user, index) => {
            embed.fields[field_index].value += user.username + "\n";
            
            field_index++;
            
            if(field_index > 2) 
                field_index = 0;
                        
        });
        
        embed.fields.forEach((field, index) => {
            if(!field.value)
                embed.fields.splice(index, 1);
            
        });
        
        if(config.debug)
            helper.log(embed);
        
        msg.channel.send({embed: embed})
        .catch(helper.discordErrorHandler);
        
    }
    
}

for(let i = 0; i < SOCKET_COUNT; i++){
    let socket = {
        topics: 0,
        ws: new WebSocket('wss://pubsub-edge.twitch.tv/v1')
        
    }
    
    sockets.push(socket);
    
}

function incomingPubSub(sub){
    let msg = JSON.parse(sub);
    
    if(msg.type != 'MESSAGE')
        return false;
    
    let topic = msg.data.topic;
    let data = JSON.parse(msg.data.message);
    let channel_id = topic.split(".").pop();
    let channel = trackedChannels[channel_id];
    let seconds = Math.round(+new Date() / 1000 - data.server_time);
    
    if(topic.startsWith('video-playback-by-id')){
        if(data.type == 'stream-up'){
            if(config.debug)
                helper.log(`${channel.display_name} is now live!`);
            
            if(channel.live){
                let _channel = JSON.parse(JSON.stringify(channel));
                _channel.live = false;
                _channel.ending = false;
                _channel.end_date = moment().unix();
                updateTwitchChannel(_channel);
                
            }
            
            channel.live = true;
            channel.ending = false;
            
            if(moment().unix() - channel.start_date < 600){
                if(config.debug)
                    helper.log('last stream shortly ago, edit message');
                
                updateTwitchChannel(channel);
                
            }else{
                channel.peak_viewers = 0;
                channel.viewers = 0;
                channel.start_date = data.server_time;
                
                for(discord_channel_id in channel.channels){
                    let discord_channel = client.channels.get(discord_channel_id);
                    let _channel_id = discord_channel_id;
                    
                    if(_channel_id in redirectChannels)
                        discord_channel = client.channels.get(redirectChannels[_channel_id]);
                    
                    let highlights = channel.channels[_channel_id].notifies.join(" ");
                    
                    if(discord_channel){
                        discord_channel
                        .send(highlights,
                            {embed: helper.formatTwitchEmbed(channel)})
                        
                        .then(_msg => {
                            if(config.debug)
                                helper.log(`live message posted in ${_channel_id}, has msg_id ${_msg.id}`);
                            
                            channel.channels[_channel_id].msg_id = _msg.id;
                            helper.saveJSON('trackedChannels', trackedChannels);
                            
                        }).catch(helper.discordErrorHandler);
                        
                    }
                    
                }
                
                if(!config.allowDM)
                    return false;
            
                for(discord_user_id in channel.dm_channels){
                    let _user_id = discord_user_id;
                    let discord_user = client.users.get(_user_id);
                    
                    if(discord_user){
                        discord_user
                        .send({embed: helper.formatTwitchEmbed(channel)})
                        .then(_msg => {
                            channel.dm_channels[_user_id].msg_id = _msg.id;
                            helper.saveJSON('trackedChannels', trackedChannels);
                            
                        }).catch(helper.discordErrorHandler);
                        
                    }
                    
                }
                
            }
            
            helper.saveJSON('trackedChannels', trackedChannels);
            
        }else if(data.type == 'stream-down'){
            channel.ending = true;
            channel.end_date = data.server_time;
            updateTwitchChannel(channel);
            helper.saveJSON('trackedChannels', trackedChannels);
            
        }else if(data.type == 'viewcount'){
            channel.viewers = data.viewers;
            if(channel.viewers > channel.peak_viewers) channel.peak_viewers = channel.viewers;
            helper.saveJSON('trackedChannels', trackedChannels);
            
        }
        
    }else if(topic.startsWith('broadcast-settings-update')){
        if(data.type == 'broadcast_settings_update'){
            if(data.game !== null && data.status !== null){
                channel.game = data.game;
                channel.status = data.status;
                
            }
            
            if(channel.game === null)
                channel.game = 'None';
            
            if(channel.status === null)
                channel.status = channel.display_name;
            
            helper.saveJSON('trackedChannels', trackedChannels);
            
        }
        
    }
    
}

function trackTwitchUser(user_id, channel){
    for(let i = 0; i < SOCKET_COUNT; i++){
        let socket = sockets[i];
        
        if(socket.topics > 47)
            continue;
        
        channel.socket = i;
        helper.saveJSON('trackedChannels', trackedChannels);
        
        socket.ws.send(`{"type":"LISTEN","data":{"topics":["video-playback-by-id.${user_id}"]}}`);
        // stream up, stream down, viewer count
        
        socket.ws.send(`{"type":"LISTEN","data":{"topics":["broadcast-settings-update.${user_id}"]}}`);
        // title change, game change
         
        socket.topics += 2;
        
        return true;
        
    }
    
    return false;
    
}

function untrackTwitchUser(user_id, discord_id, type, channel){
    let socket = sockets[channel.socket];
    
    if(type == 'dm')
        delete trackedChannels[user_id].dm_channels[discord_id];
    else
        delete trackedChannels[user_id].channels[discord_id];
    
    if(Object.keys(trackedChannels[user_id].channels).length + Object.keys(trackedChannels[user_id].dm_channels).length == 0){
        delete trackedChannels[user_id];
        socket.ws.send(`{"type":"UNLISTEN","data":{"topics":["video-playback-by-id.${user_id}"]}}`);
        socket.ws.send(`{"type":"UNLISTEN","data":{"topics":["broadcast-settings-update.${user_id}"]}}`);
        
        socket.topics -= 2;
        
    }
    
    helper.saveJSON("trackedChannels", trackedChannels);
    
}

function updateTwitchChannel(channel){
    if(channel.ending){
        channel.live = false;
        helper.saveJSON('trackedChannels', trackedChannels);
        
    }
    
    for(discord_channel_id in channel.channels){
        let discord_channel = client.channels.get(discord_channel_id);
        
        if(discord_channel_id in redirectChannels)
            discord_channel = client.channels.get(redirectChannels[discord_channel_id]);
        
        if(discord_channel && channel.channels[discord_channel_id].msg_id){
            let highlights = ""
            
            if(channel.live)
                highlights = channel.channels[discord_channel_id].notifies.join(" ");
            
            discord_channel.fetchMessage(channel.channels[discord_channel_id].msg_id).then(_msg => {
                _msg
                .edit(highlights, {embed: helper.formatTwitchEmbed(channel)})
                .catch(helper.discordErrorHandler);
                
            }).catch(err => {
                delete channel.channels[discord_channel_id].msg_id;
                
            });
            
        }
        
    }
    
    for(discord_user_id in channel.dm_channels){
        let discord_user = client.users.get(discord_user_id);
        if(discord_user){
            let dm_channel = discord_user.dmChannel;
            if(dm_channel && channel.dm_channels[discord_user_id].msg_id){
                dm_channel.fetchMessage(channel.dm_channels[discord_user_id].msg_id).then(_msg => {
                    _msg
                    .edit({embed: helper.formatTwitchEmbed(channel)})
                    .catch(helper.discordErrorHandler);
                    
                });
                
            }
            
        }
    }
    
}

setInterval(function(){
    sockets.forEach(socket => {
        socket.ws.send('{"type":"PING"}'); // keep sockets alive
        
    });
    
    let request_form = '';
    
    for(id in trackedChannels){
        if(trackedChannels[id].live){
            if(request_form != '')
                request_form += '&';
            
            request_form += `user_id=${id}`;
            
        }
        
    }
    
    helixApi.get(`streams?${request_form}`).then(response => {
        let data = response.data.data;
                
        if(data.length == 0){
            msg.channel.send(`Twitch user \`${username}\` not found!`)
            .catch(helper.discordErrorHandler);
            
            return false;
            
        }
        
        let twitchStreams = data;
                
        for(id in trackedChannels){
            let channel = trackedChannels[id];
            
            if(channel.live){
                if(moment().unix() - channel.start_date >= 300){
                    let filter = twitchStreams.filter(a => a.user_id == id);
                    
                    if(filter.length == 0){
                        channel.ending = true;
                        channel.end_date = moment().unix();
                        
                    }
                    
                }
                
                helper.saveJSON('trackedChannels', trackedChannels);
                
                updateTwitchChannel(channel);
                
            }
            
        }
        
    }).catch(helper.error);
    
}, 60 * 1000);

sockets.forEach((socket, index) => {
   socket.ws.on('message', data => {
       incomingPubSub(data);
       
   });
   
   socket.ws.on('open', () => {
        if(socket.reopen){
            for(id in trackedChannels){
                if(trackedChannels[id].socket == index){
                    socket.ws.send(`{"type":"LISTEN","data":{"topics":["video-playback-by-id.${id}"]}}`);
                    socket.ws.send(`{"type":"LISTEN","data":{"topics":["broadcast-settings-update.${id}"]}}`);
                    
                }
                
            }
            
            socket.ws.send(`{"type":"LISTEN","data":{"topics":["broadcast-settings-update.0"]}}`); 
            
            return false;
            
        }
        
        open_sockets++;
        
        if(open_sockets == SOCKET_COUNT){ // all sockets opened, start subscribing to events
            for(id in trackedChannels){
                let channel = trackedChannels[id];
                
                if(Object.keys(channel.channels).length == null && !config.allowDM)
                    return false;
                
                trackTwitchUser(id, channel);
            }
            
        }
        // subscribe to topic that doesn't exist to prevent socket connection being closed by twitch
        
        socket.topics++;
        
   });
   
   socket.ws.on('close', () => {
       sockets[index].reopen = true;
       sockets[index].ws = new WebSocket('wss://pubsub-edge.twitch.tv/v1');
       
   });
   
});
