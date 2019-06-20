const credentials = require('./credentials.json');
const helper = require('./helper');

const DEBUG = helper.getOption('debug');

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

const TWITCH_API_DELAY = 3 * 60;

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

client.on('error', helper.error);

client.once('ready', () => {
    helper.log(`Invite bot to server: https://discordapp.com/api/oauth2/authorize?client_id=${credentials.discord.clientID}&permissions=8&scope=bot`);

    let avatar_md5 = crypto.createHash('md5').update(fse.readFileSync(helper.getOption('avatarPath'))).digest("hex");

    if(dataStore.avatarSet == avatar_md5)
        return false;

    if(!helper.getOption('setAvatar'))
        return false;

    if(DEBUG)
        helper.log('avatar file has changed, updating');

    client.user.setAvatar(helper.getOption('avatarPath'))
    .then(() => {
        dataStore.avatarSet = avatar_md5
        helper.saveJSON('dataStore', dataStore);

        if(DEBUG)
            helper.log('avatar updated');

    }).catch(helper.discordErrorHandler);

});

client.on('message', onMessage);

client.login(credentials.discord.token);

function onMessage(msg){
    let argv = msg.content.split(' ');

    if(helper.checkCommand(msg, helper.getOption('commands', 'twitchTrack'))){
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

                if(msg.channel.type == 'dm' && helper.getOption('allowDM')){
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
                                if(DEBUG)
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
            msg.channel.send(
                `usage: \`${helper.getOption('prefix')}${helper.getOption('commands', 'twitchTrack', 'cmd')[0]} <twitch username>\``
            )
            .catch(helper.discordErrorHandler);

        }
    }

    if(helper.checkCommand(msg, helper.getOption('commands', 'twitchUntrack'))){
        if(argv.length != 2){
            msg.channel.send(
                `usage: \`${helper.getOption('prefix')}${helper.getOption('commands', 'twitchUntrack', 'cmd')[0]} <twitch username>\``
            )
            .catch(helper.discordErrorHandler);

            return false;

        }

        let username = argv[1];

        if(DEBUG)
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

    if(helper.checkCommand(msg, helper.getOption('commands', 'twitchRedirect'))){
        if(msg.channel.type != 'text')
            return false;

        if(argv.length != 2){
            msg.channel.send(
                `usage: \`${helper.getOption('prefix')}${helper.getOption('commands', 'twitchRedirect', 'cmd')[0]} <discord channel mention>\``
            )
            .catch(helper.discordErrorHandler);
            return false;

        }

        try{
            let channel_id = argv[1].split('#').pop().split('>')[0];
            let output_channel = msg.guild.channels.get(channel_id);

            if(output_channel){
                if(DEBUG)
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
            msg.channel.send(
                `usage: \`${helper.getOption('prefix')}${helper.getOption('commands', 'twitchRedirect', 'cmd')[0]} <discord channel mention>\``
            )
            .catch(helper.discordErrorHandler);

        }

    }

    if(helper.checkCommand(msg, helper.getOption('commands', 'twitchNotify'))){
        if(msg.channel.type != 'text')
            return false;

        if(argv.length != 2){
            msg.channel.send(`usage: \`${helper.getOption('prefix')}${helper.getOption('commands', 'twitchNotify', 'cmd')[0]} <twitch username>\``)
            .catch(helper.discordErrorHandler);

            return false;

        }

        let username = argv[1];

        if(DEBUG)
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

    if(helper.checkCommand(msg, helper.getOption('commands', 'twitchUnnotify'))){
        if(msg.channel.type != 'text')
            return false;

        if(argv.length != 2){
            msg.channel.send(
                `usage: \`${helper.getOption('prefix')}${helper.getOption('commands', 'twitchUnnotify', 'cmd')[0]} <twitch username>\``
            )
            .catch(helper.discordErrorHandler);

            return false;

        }

        let username = argv[1];

        if(DEBUG)
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

    if(helper.checkCommand(msg, helper.getOption('commands', 'twitchNotifyRole'))){
        if(msg.channel.type != 'text')
            return false;

        if(argv.length != 3){
            msg.channel.send(`usage: \`${helper.getOption('prefix')}${helper.getOption('commands', 'twitchNotifyRole', 'cmd')[0]} <twitch username> <role name (case sensitive)>\``)
            .catch(helper.discordErrorHandler);

            return false;

        }

        let username = argv[1];
        let rolename = argv[2];

        if(DEBUG)
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

            let roles = msg.guild.roles.filter(role => role.name.toLowerCase() == rolename.toLowerCase());

            if(roles.length == 0){
                msg.channel.send(`\`${rolename}\` role not found!`)
                .catch(helper.discordErrorHandler);

                return false;

            }

            let role = roles.first();

            if(channel.notifies.includes(`<@&${role.id}>`)){
                msg.channel.send(`This role is already being notified when \`${username}\` is streaming!`)
                .catch(helper.discordErrorHandler);

                return false;

            }

            channel.notifies.push(`<@&${role.id}>`);
            helper.saveJSON("trackedChannels", trackedChannels);

            msg.channel.send(`This role is now being notified when \`${username}\` is streaming!`)
            .catch(helper.discordErrorHandler);

        }).catch(helper.error);
    }

    if(helper.checkCommand(msg, helper.getOption('commands', 'twitchUnnotifyRole'))){
        if(msg.channel.type != 'text')
            return false;

        if(argv.length != 3){
            msg.channel.send(
                `usage: \`${helper.getOption('prefix')}${helper.getOption('commands', 'twitchUnnotifyRole', 'cmd')[0]} <twitch username> <role name>\``
            )
            .catch(helper.discordErrorHandler);

            return false;

        }

        let username = argv[1];
        let rolename = argv[2];

        if(DEBUG)
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

            let roles = msg.guild.roles.filter(role => role.name.toLowerCase() == rolename.toLowerCase());

            if(roles.length == 0){
                msg.channel.send(`\`${rolename}\ role not found!`)
                .catch(helper.discordErrorHandler);

                return false;

            }

            let role = roles.first();

            if(!(channel.notifies.includes(`<@&${role.id}>`))){
                msg.channel.send(`This role is not being notified when \`${username}\` is streaming!`)
                .catch(helper.discordErrorHandler);

                return false;

            }

            channel.notifies = channel.notifies.filter(a => a != `<@&${role.id}>`);
            helper.saveJSON("trackedChannels", trackedChannels);

            msg.channel.send(`This role is longer being notified when \`${username}\` is streaming`)
            .catch(helper.discordErrorHandler);

        }).catch(helper.error);

    }

    if(helper.checkCommand(msg, helper.getOption('commands', 'twitchEveryone'))){
        if(msg.channel.type != 'text')
            return false;

        if(argv.length != 2){
            msg.channel.send(
                `usage: \`${helper.getOption('prefix')}${helper.getOption('commands', 'twitchEveryone', 'cmd')[0]} <twitch username>\``
            )
            .catch(helper.discordErrorHandler);

            return false;

        }

        let username = argv[1];

        if(DEBUG)
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

            let everyoneMentioned = channel.notifies.includes('@everyone');

            if(everyoneMentioned){
                channel.notifies = channel.notifies.filter(a => a != '@everyone');
                msg.channel.send(`Stopped mentioning everyone when \`${username}\` is streaming`)
                .catch(helper.discordErrorHandler);

            }else{
                channel.notifies.push('@everyone');
                channel.notifies = channel.notifies.filter(a => a != '@here');
                msg.channel.send(`Now mentioning everyone when \`${username}\` is streaming`)
                .catch(helper.discordErrorHandler);

            }

            helper.saveJSON("trackedChannels", trackedChannels);

        }).catch(helper.error);

    }

    if(helper.checkCommand(msg, helper.getOption('commands', 'twitchHere'))){
        if(msg.channel.type != 'text')
            return false;

        if(argv.length != 2){
            msg.channel.send(
                `usage: \`${helper.getOption('prefix')}${helper.getOption('commands', 'twitchHere', 'cmd')[0]} <twitch username>\``
            )
            .catch(helper.discordErrorHandler);

            return false;

        }

        let username = argv[1];

        if(DEBUG)
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

            let hereMentioned = channel.notifies.includes('@here');

            if(hereMentioned){
                channel.notifies = channel.notifies.filter(a => a != '@here');
                msg.channel.send(`Stopped mentioning everyone currently here when \`${username}\` is streaming`)
                .catch(helper.discordErrorHandler);

            }else{
                channel.notifies.push('@here');
                channel.notifies = channel.notifies.filter(a => a != '@everyone');
                msg.channel.send(`Now mentioning everyone currently here when \`${username}\` is streaming`)
                .catch(helper.discordErrorHandler);

            }

            helper.saveJSON("trackedChannels", trackedChannels);

        }).catch(helper.error);

    }

    if(helper.checkCommand(msg, helper.getOption('commands', 'twitchTracking'))){
        let tracked = [];

        for(id in trackedChannels){
            if(msg.channel.type == 'dm' && helper.getOption('allowDM')){
                if(msg.author.id in trackedChannels[id].dm_channels)
                    tracked.push(trackedChannels[id]);

            }else{
                if(msg.channel.id in trackedChannels[id].channels)
                    tracked.push(trackedChannels[id]);

            }

        }

        if(tracked.length == 0){
            msg.channel.send("This channel doesn't have any tracked channels yet!")
            .catch(helper.discordErrorHandler);
            return false;

        }

        let embed = {
            color: 6570404,
            description: 'List of tracked Twitch streams in this channel.',
            author: {
                icon_url: "https://cdn.discordapp.com/attachments/572429763700981780/572429816851202059/GlitchBadge_Purple_64px.png",
                name: `Twitch Tracking`
            },
            fields: []
        };

        if(msg.channel.id in redirectChannels)
            embed.description += `\nStream announcements are posted in <#${redirectChannels[msg.channel.id]}>.`;

        let field_index = 0;

        if(msg.channel.type != 'dm')
            embed.description += `\nStreams that mention everyone are marked with a star \*, if they only mention people currently here they're marked with two stars. Streams that mention you are written in **bold** text.`;

        tracked.forEach((user, index) => {
            if(embed.fields.length < 3){
                embed.fields.push({
                    name: '⠀',
                    value: '',
                    inline: true
                });
            }

            let username = user.username;

            if(msg.channel.type != 'dm'){
                if(user.channels[msg.channel.id].notifies.includes(`<@${msg.author.id}>`))
                    username = `**${username}**`;

                if(user.channels[msg.channel.id].notifies.includes('@everyone'))
                    username += '\*';

                if(user.channels[msg.channel.id].notifies.includes('@here'))
                    username += '\*\*';

            }

            embed.fields[field_index].value += username + "\n";

            field_index++;

            if(field_index > 2)
                field_index = 0;

        });

        if(DEBUG)
            helper.log(embed);

        msg.channel.send({embed: embed})
        .catch(helper.discordErrorHandler);

    }

    if(helper.checkCommand(msg, helper.getOption('commands', 'pagkibot'))){
        msg.channel.send({embed:
            {
                description: "Discord bot for instant twitch live notifications using Twitch's PubSub API. Tracked channels are updated every minute with updated titles, game names and viewcounts.",
                url: "https://github.com/LeaPhant/pagkibot",
                color: 8635882,
                footer: {
                    icon_url: "https://avatars1.githubusercontent.com/u/14080165?s=64",
                    text: "LeaPhant"
                },
                thumbnail: {
                    url: "https://raw.githubusercontent.com/LeaPhant/pagkibot/master/res/avatar.png"
                },
                author: {
                    name: "pagkibot",
                    url: "https://discordapp.com",
                    icon_url: "https://cdn.discordapp.com/attachments/572429763700981780/572429816851202059/GlitchBadge_Purple_64px.png"
                },
                fields: [
                    {name: "GitHub Repo", "value": "https://github.com/LeaPhant/pagkibot"},
                    {name: "Commands", "value": "https://github.com/LeaPhant/pagkibot/wiki/4.-Commands"}
                ]
            }
        }).catch(helper.discordErrorHandler);
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
            if(DEBUG)
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

            krakenApi.get(`channels/${channel.username}`).then(response => {
                let data = response.data;

                channel.game = data.game;
                channel.status = data.status;

                if(moment().unix() - channel.end_date < 600){
                    if(DEBUG)
                        helper.log('last stream shortly ago, edit message');

                    updateTwitchChannel(channel);

                }else{
                    channel.peak_viewers = 0;
                    channel.viewers = 0;
                    channel.start_date = data.server_time;

                    postTwitchChannel(channel);

                }

                helper.saveJSON('trackedChannels', trackedChannels);

            }).catch(console.error);

        /*}else if(data.type == 'stream-down'){
            channel.ending = true;
            channel.end_date = data.server_time;
            updateTwitchChannel(channel);
            helper.saveJSON('trackedChannels', trackedChannels);

        TODO: fix this
        */

        }else if(data.type == 'viewcount'){
            channel.viewers = data.viewers;
            if(channel.viewers > channel.peak_viewers) channel.peak_viewers = channel.viewers;
            helper.saveJSON('trackedChannels', trackedChannels);

        }

    }

}

function trackTwitchUser(user_id, channel){
    for(let i = 0; i < SOCKET_COUNT; i++){
        let socket = sockets[i];

        if(socket.topics > 48)
            continue;

        channel.socket = i;
        helper.saveJSON('trackedChannels', trackedChannels);

        socket.ws.send(`{"type":"LISTEN","data":{"topics":["video-playback-by-id.${user_id}"]}}`);
        // stream up, stream down, viewer count

        socket.topics++;

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

        socket.topics--;

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
            let highlights = "";

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

function postLiveMessage(channel, discord_channel, message, embed, cb){
  discord_channel
  .send(message, {embed: helper.formatTwitchEmbed(channel)})
  .then(_msg => {
      if(DEBUG)
          helper.log(`live message posted in ${_channel_id}, has msg_id ${_msg.id}`);

      channel.channels[_channel_id].msg_id = _msg.id;
      helper.saveJSON('trackedChannels', trackedChannels);

      if(typeof cb === 'function') cb();

  }).catch(err => {
      if(typeof cb === 'function') cb();
      helper.discordErrorHandler(err);

  });
}

function postTwitchChannel(channel){
    for(discord_channel_id in channel.channels){
        let discord_channel = client.channels.get(discord_channel_id);
        let _channel_id = discord_channel_id;

        if(_channel_id in redirectChannels)
            discord_channel = client.channels.get(redirectChannels[_channel_id]);

        if(discord_channel){
            let highlights = channel.channels[_channel_id].notifies.join(" ");

            let roles = channel.channels[_channel_id].notifies.filter(a => a.startsWith("<@&"));

            if(roles.length > 0){
                let promises = [];
                let unmention_roles = [];

                roles.forEach(role_mention => {
                    let role_id = role_mention.substr(3);
                    role_id = Number(role_id.substr(0, role_id.length - 1));
                    let role = discord_channel.guild.roles.get(role_id);
                    if(role && !role.mentionable){
                        promises.push(role.setMentionable(true));
                        unmention_roles.push(role);

                    }
                });

                Promise.all(promises).then(() => {
                      postLiveMessage(channel, discord_channel, highlights, helper.formatTwitchEmbed, () => {
                        unmention_roles.forEach(role => {
                            role.setMentionable(false);

                        });
                    });

                });

            }else{
                postLiveMessage(channel, discord_channel, highlights, helper.formatTwitchEmbed);
            }
        }
    }

    if(!helper.getOption('allowDM'))
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

function updateChannels(){
    sockets.forEach(socket => {
        socket.ws.send('{"type":"PING"}'); // keep sockets alive

    });

    let checkChannels = [];

    for(id in trackedChannels)
        checkChannels.push({id: id, username: trackedChannels[id].username});

    let stream_requests = [], user_requests = [];

    for(let i = 0; i < checkChannels.length; i += 100){
        stream_requests.push(
            krakenApi.get(`streams?limit=100&channel=${checkChannels.slice(i, i + 100).map(a => a.username).join(',')}`)
        );

        user_requests.push(
            helixApi.get(`users?limit=100&id=${checkChannels.slice(i, i + 100).map(a => a.id).join('&id=')}`)
        );

    }

    Promise.all(stream_requests).then(results => {
        let twitchStreams = [];

        results.forEach(result => {
            twitchStreams = twitchStreams.concat(result.data.streams);
        });

        for(id in trackedChannels){
            let channel = trackedChannels[id];

            let filteredStreams = twitchStreams.filter(a => a.channel._id == id);
            let stream;

            if(filteredStreams.length > 0)
                stream = filteredStreams[0];

            if(stream){
                channel.game = stream.game;
                channel.status = stream.channel.status;
                channel.start_date = moment(stream.created_at).unix();
                channel.end_date = moment().unix();
            }

            if(channel.live){
                if(!stream && moment().unix() - channel.start_date >= TWITCH_API_DELAY){
                    channel.ending = true;
                    channel.end_date = moment().unix();

                }

                updateTwitchChannel(channel);

            }else{
                if(stream){
                    channel.live = true;
                    channel.ending = false;

                    if(moment().unix() - channel.start_date < 600){
                        if(DEBUG)
                            helper.log('last stream shortly ago, edit message');

                        updateTwitchChannel(channel);

                    }else{
                        postTwitchChannel(channel);

                    }

                }

            }

            helper.saveJSON('trackedChannels', trackedChannels);

        }

    }).catch(helper.error);

    Promise.all(user_requests).then(results => {
        let twitchUsers = [];

        results.forEach(result => {
            twitchUsers = twitchUsers.concat(result.data.data);
        });

        twitchUsers.forEach(twitchUser => {
            let channel = trackedChannels[twitchUser.id];
            channel.username = twitchUser.login;
            channel.display_name = twitchUser.display_name;
            channel.avatar = twitchUser.profile_image_url;

        });

        helper.saveJSON('trackedChannels', trackedChannels);

    }).catch(helper.error);
}

setInterval(updateChannels, 60 * 1000);
setTimeout(updateChannels, 4000);

sockets.forEach((socket, index) => {
   socket.ws.on('message', data => {
       incomingPubSub(data);

   });

   socket.ws.on('open', () => {
        if(socket.reopen){
            for(id in trackedChannels){
                if(trackedChannels[id].socket == index){
                    socket.ws.send(`{"type":"LISTEN","data":{"topics":["video-playback-by-id.${id}"]}}`);

                }

            }

            return false;

        }

        open_sockets++;

        if(open_sockets == SOCKET_COUNT){ // all sockets opened, start subscribing to events
            for(id in trackedChannels){
                let channel = trackedChannels[id];

                if(channel.channels.length == null && !helper.getOption('allowDM'))
                    return false;

                trackTwitchUser(id, channel);
            }

        }

        socket.ws.send(`{"type":"LISTEN","data":{"topics":["broadcast-settings-update.0"]}}`);

        // subscribe to topic that doesn't exist to prevent socket connection being closed by twitch

        socket.topics++;

   });

   socket.ws.on('close', () => {
       sockets[index].reopen = true;
       sockets[index].ws = new WebSocket('wss://pubsub-edge.twitch.tv/v1');

   });

});
