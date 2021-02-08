const Discord = require('discord.js');
const fs = require('fs');
const axios = require('axios');
const puppeteer = require('puppeteer');
const client = new Discord.Client();

const get = (name, extension = 'json') =>
	JSON.parse(fs.readFileSync(`./${name}.${extension}`));
const set = (vari, extension = 'json') => {
	const [name, data] = Object.entries(vari)[0];
	fs.writeFileSync(`./${name}.${extension}`, JSON.stringify(data, null, 2));
}


function updateStat(fn, file) {
	const data = fn(get(file));
	set({ [file]: data });
}
function sendDelete(text, msg, time = 3000) {
	msg.channel.send(text)
		.then(message => setTimeout(() => message.delete(), time));
	msg.delete();
}
function deleteEvent(event) {
	const events = get('events');
	//delete the mesages
	Object.values(event.messages).forEach(msgId => {
		client.guilds.cache.get(event.guildID)
			.channels.cache.get(event.channelID).messages.fetch(msgId)
			.then(message => message.delete()
				.catch(err => console.log('Error: in deleting messages')))
			.catch(err => console.log('Error: Message not found'))
	});

	delete events[event.title];
	set({ events });
}
function reactOk(message) {
	const config = get('config');
	message.react(config.doneEmoji);
}

client.on('message', msg => {
	if (msg.author == client.user) { return }

	let fn;
	//event bot
	if (msg.content.startsWith('event clear')) { fn = clear }
	else if (msg.content.startsWith('event time')) { fn = time }
	else if (msg.content.startsWith('event future')) { fn = future }
	else if (msg.content.startsWith('event presets')) { fn = sendPresets }
	//event kewords have to be last
	else if (msg.content.toLowerCase().startsWith('event ')) { fn = createEvent }
	else if (msg.content.toLowerCase().startsWith('meeting ')) { fn = createEvent }
	else if (msg.content.toLowerCase().startsWith('call ')) { fn = createEvent }
	//sleep bot
	else if (msg.content.startsWith('sleep history')) { fn = sendHistory }
	else if (msg.content.startsWith('sleep stats')) { fn = sendSleepStats }
	else if (msg.content.startsWith('slept ')) { fn = logSleep }
	//misc
	else if (msg.content.startsWith('debug ')) { fn = sendDebug }
	else if (msg.content.startsWith('define ')) { fn = define }
	else if (msg.content.startsWith('help')) { fn = help }
	else { fn = checkForOthers }

	let config = get('config');
	let events = get('events');
	let log = get('log');

	try {
		fn({ msg, config, events, log });
	} catch (err) {
		sendDelete(`❗${err}❗`, msg, 5000);
		console.log(err);
	}
});
function checkForOthers({ msg, config, events }) {
	const isKeyword = () => {
		//do a better check to see ifs a preset or not
		const keyword = msg.content.toLowerCase();
		const time = config.presets[keyword];

		if (time === undefined) { return }//not a preset

		msg.content = `event ${time} ${keyword.toUpperCase()}`;
		createEvent({ msg, config, events });
	}
	const isNoU = () => {
		msg.channel.send('No U!');
		updateStat(cnf => {
			cnf.register[msg.author.id].stats.noUs += 1;
			return cnf;
		}, 'config');
	}
	const isPoll = () => {
		['👍', '👎'].forEach(emoji => msg.react(emoji));
	}
	const isRate = () => {
		['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']
			.forEach(emoji => msg.react(emoji));
	}

	if (Object.keys(config.presets).includes(msg.content.toLowerCase())) {
		isKeyword();
	} else if (config.noYouSpellings.some(word => msg.content.includes(word))) {
		isNoU();
	} else if (msg.content.toLowerCase().endsWith('?')) {
		isPoll();
	} else if (msg.channel.id == Object.values(config.guilds)[0].rateChannel) {
		isRate();
	}
	else { return }
}




function isRSVP(reaction, user, added, { config, events }) {
	const updateAttendies = (event) => {
		reaction.message.reactions.removeAll();
		reaction.message.react('👍');
		reaction.message.react('👎');
		reaction.message.react('❌');


		let attendies = Object.keys(event.people)
			.filter(id => event.people[id].status !== null)
			.map(id => {
				const emojiObj = event.people[id].status ?
					config.register[id].emoji.happy :
					config.register[id].emoji.sad;
				return `<:${emojiObj.name}:${emojiObj.id}>`;
			})
			.join('  ');

		attendies == '' ? attendies = '🚷' : 0;
		const text = `${event.emoji}        ${attendies}        ${event.emoji}`;

		reaction.message.channel.messages.fetch(event.messages.guestList)
			.then(message => message.edit(text));
	}
	const sendSass = (user) => {
		user.send(config.responses[Math.floor(Math.random() * config.responses.length)]);
	}

	//if message is not sent by the bot / person isnt invited
	if (reaction.message.author.id != client.user.id) { return }
	const event = Object.values(events)
		.filter(event => event.messages.readback == reaction.message.id)
		.pop();
	if (event === undefined) { return } // didn't react to a readback

	if (!(Object.keys(event.people).includes(user.id))) { throw 'You are not part of the event 😢' }

	if (['👍', '👎'].includes(reaction.emoji.name)) {
		const emojiMeaning = config.emojiIdx[reaction.emoji.name];

		event.people[user.id].status =
			emojiMeaning == event.people[user.id].status ? null : emojiMeaning;
		event.people[user.id].status === false && added ? sendSass(user) : 0;

		updateAttendies(event);
		updateStat(cnf => {
			cnf.register[user.id].stats.eventsAttended += 1;
			return cnf;
		}, 'config');

		events[event.title] = event;
		set({ events });
	} else { //must be ❌
		if (event.creator != user.id) {
			if (!added) { throw `${user} the damage was already done bud` }
			else {
				reaction.message.channel.send(`<!${event.creator}>, ${user} wants to delete your event called **${event.title}**`);
				return
			}
		}

		deleteEvent(event);
	}

}
function isDeleteDay(reaction, user, added, { config, log }) {
	if (!added) { return }

	const date = reaction.message.content.split('__')[1];
	delete log[date][user.id];
	if (Object.keys(log[date]).length === 0) {
		delete log[date];
		reaction.message.delete();
	} else {
		const submiters = Object.entries(log[date])
			.map(([id, percent]) => `**${config.register[id].username}**: ${percent}%`)
			.join('\n')
		reaction.message.edit(`__${date}__\n${submiters}`);
	}

	set({ log });

	msg.channel.send(`${user}, Your entry for **${date}** day has been removed`).then(reactOk);
}
function deleteMessage(reaction, user, added) {
	if (!added) { return }
	if (reaction.message.author != client.user) { return };

	reaction.message.delete();
}

function messageReaction(reaction, user, added) {
	if (user == client.user) { return }
	let config = get('config');

	let fn;
	if (['👍', '👎', '❌'].includes(reaction.emoji.name)) { fn = isRSVP }
	else if ('🗑' == reaction.emoji.name) { fn = isDeleteDay }
	else if (config.doneEmoji == reaction.emoji.name) { fn = deleteMessage }
	else { return }

	let events = get('events');
	let log = get('log');
	try {
		fn(reaction, user, added, { config, events, log });
	} catch (err) {
		reaction.message.channel.send(`❗${err}❗`);
		console.log(err);
	}
}
client.on('messageReactionAdd', (r, u) => messageReaction(r, u, true));
client.on('messageReactionRemove', (r, u) => messageReaction(r, u, false));

function updateRegister() {
	const config = get('config');
	Object.keys(config.guilds).forEach(guildID => {
		client.guilds.cache.get(guildID).members.cache
			.forEach(({ user: { id, username, discriminator, bot } }) => {
				if (Object.keys(config.register).includes(id)) {
					config.register[id].username = username;
					config.register[id].bot = bot;
					config.register[id].discriminator = discriminator;
				}
				else {
					config.register[id] = { id, username, discriminator, bot };
					if (!bot) {
						config.register[id].stats = {
							debugs: 0,
							definitions: 0,
							noUs: 0,
							eventsCreated: 0,
							eventsAttended: 0,
						};
					}
				}
				set({ config });
			})
	})
}
function sendTp2(event) {
	Object.keys(event.people)
		.filter(id => event.people[id].status === true)
		.forEach(id => {
			const user = client.guilds.cache.get(event.guildID).members.cache.get(id);
			if (user !== undefined && !user.voice.channel) {
				//user isn't cached OR user isn't connected
				user.send(`You're late to your meeting called **${event.title}**`);
			}

		})
}
function sendTm0(event) {
	Object.entries(event.people)
		.filter(([id, usrData]) => usrData.status !== false)
		.forEach(async ([id, usrData]) => {
			const config = get('config');

			const user = await client.users.fetch(id);
			user.send(`${config.reminder[JSON.stringify(usrData.status)]} titled ${event.title}`);
		});
}
function sendTm15(event) {
	Object.keys(event.people)
		.filter(id => event.people[id].status == null)
		.forEach(async id => {
			const user = await client.users.fetch(id)
			user.send(`You have not responded to a discord meeting taking place in 15 minutes titled **${event.title}**!`)
		});
}
client.on('ready', () => {
	const isMinsFromNow = (mins, event) =>
		new Date >= new Date(event.date) - (60 * 1000 * mins)


	console.log(`Logged in as ${client.user.tag}`);
	client.user.setPresence({
		activity: {
			name: 'for events',
			type: 'WATCHING',
		}
	})
	updateStat(cnf => {
		cnf.hosted = process.env._ && process.env._.indexOf("heroku");
		return cnf;
	}, 'config');

	setInterval(() => {
		updateRegister();
		const events = get('events');

		Object.values(events).forEach(event => {

			if (isMinsFromNow(-2, event) && !event.reminders.tp2) {
				sendTp2(event);
				events[event.title].reminders.tp2 = true;
				deleteEvent(event);
			} else if (isMinsFromNow(0, event) && !event.reminders.tm0) {
				sendTm0(event);
				events[event.title].reminders.tm0 = true;
			} else if (isMinsFromNow(15, event) && !event.reminders.tm15) {
				sendTm15(event);
				events[event.title].reminders.tm15 = true;
			} else { return }
			set({ events });
		});
	}, 1000);
});

function sendDebug({ msg }) {
	let file;
	if (msg.content.endsWith('config')) { file = 'config' }
	else if (msg.content.endsWith('events')) { file = 'events' }
	else if (msg.content.endsWith('log')) { file = 'log' }
	else { throw 'Valid files are \`events\`, \`config\`, \`log\`' }

	msg.channel.send(`\`${JSON.stringify(get(file), null, 2)}\``).then(reactOk)
		.catch(err => {
			if (err.code == 50035) { // message too long
				fs.writeFileSync('./temp.txt', JSON.stringify(get(file), null, 2));
				msg.channel.send({ files: [`./temp.txt`] });
			}
		});
	updateStat(cnf => {
		cnf.register[msg.author.id].stats.debugs += 1;
		return cnf
	}, 'config');
	msg.delete();
}

function help({ msg, config }) {
	const help = Object.entries(config.help)
		.map(([botname, commands]) => {
			commands = Object.entries(commands)
				.map(([command, descrption]) => `\t\`${command}\`  :  (${descrption})`)
				.join('\n');
			return `__${botname}__:\n${commands}`
		})
		.join('\n');

	msg.channel.send(help).then(reactOk);
	msg.delete();
}

function sendPresets({ msg, config }) {
	const presets = Object.entries(config.presets)
		.map(([keyWord, time]) => `\t\`${keyWord}\`  :  \`${time}\``)
		.join('\n');
	msg.channel.send(`__Presets include:__\n${presets}`).then(reactOk);
	msg.delete();
}
function createEvent({ msg, config, events }) {
	const getTitle = () => {
		let title = msg.content
			.split(' ')
			// + 1 for 'event' and optional + 1 for time
			.slice(msg.mentions.users.size + msg.content.includes(':') + 1)
			.join(' ')
			.replace('**', '');
		title.length == 0 ? title = 'Untitled Event' : 0;
		while (Object.keys(events).includes(title)) { title += '!'; }
		return title;
	}
	const getDate = () => {
		const msgToInput = () => {
			const parts = msg.content.split(' ');
			if (msg.content.includes(':')) {//
				const input = parts.filter(x => x.match(/:/g))[0];
				const tmr = ['tmr', 'tommorow'].filter(spelling => input.includes(spelling))[0];
				if (tmr === undefined) { return input }//no tommorow arg

				const time = input.replace(tmr, '').replace('-', '');
				const month = now.toLocaleString('default', { month: 'short' });
				return `${month}-${now.getDate() + 1}-${time}`;

			} else {
				const presetWord = parts.filter(word =>
					Object.keys(config.presets).includes(word.toLowerCase()))[0];
				const presetTime = config.presets[presetWord];
				if (presetTime === undefined) {
					return `${now.getHours() + 1 + offset}:00`;
				}
				return presetTime;
			}
		}
		const inputToDateObj = (input) => {
			let date;
			//from "3:45" or "jan-1-12:30" to new Date()
			if (input.split('-').length == 3) {
				input = `${now.getFullYear()}-${input}`; // add the year to the front
				date = new Date(input);
				date.setTime(date.getTime() + (offset * 60 * 60 * 1000));
			} else {
				const hours = parseInt(input.split(':')[0]) + offset;
				const minutes = parseInt(input.split(':')[1]);
				date = new Date(
					now.getFullYear(),
					now.getMonth(),
					now.getDate(),
					hours,
					minutes
				);
			}
			if (isNaN(date.getTime())) { throw 'Invalid time' }
			if (now > date) { throw 'Date is in the past' }
			// const sameday = now.getDate() == date.getDate();
			// console.log({ sameday })
			// console.log(date.getDate() - 5)
			return date;
		}
		const offset = config.hosted ? 5 : 0 + (config.dateOps[1].hour12 ? 12 : 0);
		const now = new Date();

		const input = msgToInput();
		return inputToDateObj(input);
	}
	const getPeople = () => {
		let mentions = msg.mentions.users.map(user => user.id);
		if (mentions.length == 0) {
			mentions = Object.keys(config.register).filter(id => !config.register[id].bot);
		}
		!mentions.includes(msg.author.id) ? mentions.push(msg.author.id) : 0;

		mentions = mentions.sort((a, b) => {
			return config.register[a].username.toUpperCase() <
				config.register[b].username.toUpperCase() ?
				-1 : 1;
		});

		const peopleObj = mentions.reduce((acc, usr) => {
			acc[usr] = {
				status: null,
				hasConnected: false,
			};
			return acc;
		}, {});
		return peopleObj;
	}
	const getEmoji = (date) => {
		let time = date.getHours() + (config.hosted ? 5 : 0);
		if (time > 12) { time -= 12 }
		if (date.getMinutes() > 15 && date.getMinutes() < 45) { time += '30'; }
		else if (date.getMinutes() > 45) { time += 1; }
		return `:clock${time}:`
	}
	const sendConfimation = (event) => {
		const displayDate = event.date.toLocaleTimeString(...config.dateOps);
		const isOrAre = Object.keys(event.people).length == 1 ? 'is' : 'are';
		const displayNames = Object.keys(event.people)
			.map(x => `<@${x}>`)
			.join(', ');
		const data = `**${event.title}** created for **${displayDate}**\n${displayNames} ${isOrAre} invited\nRespond to this message to mark your availability`;
		msg.channel.send(data)
			.then(message => {
				['👍', '👎', '❌'].forEach(emoji => message.react(emoji));
				updateStat(evts => {
					evts[event.title].messages.readback = message.id; return evts;
				}, 'events');
			});

		msg.channel.send(`${event.emoji}        🚷        ${event.emoji}`)
			.then(message => {
				updateStat(evts => {
					evts[event.title].messages.guestList = message.id; return evts;
				}, 'events');
			});

	}

	const event = {};
	event.title = getTitle();
	event.date = getDate();
	// event.dateString = getDateString();
	event.emoji = getEmoji(event.date);
	event.creator = msg.author.id;
	event.people = getPeople();
	event.guildID = msg.guild.id;
	event.channelID = msg.channel.id;
	event.messages = {
		creation: msg.id,
		readback: null,
		guestList: null,
	};
	event.reminders = {
		tp2: false,
		tm0: false,
		tm15: false,
	};
	events[event.title] = event;
	set({ events });
	sendConfimation(event);
	updateStat(cnf => {
		cnf.register[msg.author.id].stats.eventsCreated += 1;
		return cnf;
	}, 'config');
}

function clear({ msg, events }) {
	const parts = msg.content.split(' ');
	if (parts[2] !== undefined) {//clear event title
		const requestedTitle = parts.slice(2, parts.length).join(' ');
		if (Object.keys(events).includes(requestedTitle)) {
			deleteEvent(events[requestedTitle]);
			msg.channel.send(`Event titled **${requestedTitle}** has been deleted`, msg).then(reactOk);
		} else { throw `No event titled **${requestedTitle}**` }
	} else {//clear
		Object.values(events).forEach(deleteEvent);
		msg.channel.send(`All events cleared`).then(reactOk);
	}
	msg.delete();
}
function time({ msg, config }) {
	if (msg.content == 'event timetoggle') {
		config.dateOps[1].hour12 = !(config.dateOps[1].hour12);
		set({ config });
	}
	msg.channel.send(`**${config.dateOps[1].hour12 ? '12' : '24'}** Hour time is now active`).then(reactOk);
	msg.delete();
}

function future({ msg, config, events }) {
	if (Object.keys(events).length == 0) { throw 'No upcoming events 😢' }
	//TODO
	//if noone has responde INVITATIONS ARE SENT
	//If everyone has responded ITS GONNA BE A PARTY
	const calender = Object.values(events)
		.sort((aEvent, bEvent) => Date.parse(bEvent.date) - Date.parse(aEvent.date))
		.reverse()
		.map(event => {
			const date = new Date(event.date);
			const dateString = date.toLocaleTimeString(...config.dateOps);
			const people = Object.entries(event.people)
				.map(([id, usrData]) => `\t\t\t**${config.register[id].username.split(' ')[0]}** ${config.statuses[JSON.stringify(usrData.status)]}`)
				.join('\n');
			return `👉  **${event.title}** is happening at **${dateString}**, attendance:\n${people}`;
		}).join('\n\n');
	msg.channel.send(`__Upcoming events:__\n${calender}`).then(reactOk);
	msg.delete();
}
////////////////////////////////////////////////////////////////////////////////

function winningIndicies(lst, fn = Math.max) {
	const maxNum = fn(...lst);
	const indices = [];
	let idx = lst.indexOf(maxNum);
	while (idx != -1) {
		indices.push(idx);
		idx = lst.indexOf(maxNum, idx + 1);
	}
	return indices;
}


function sendHistory({ msg, log, config }) {
	const len = parseInt(msg.content.split(' ')[2]) || 5;
	Object.keys(log)
		.map(x => Date.parse(x))
		.sort()
		.map(x => new Date(x).toDateString())
		.slice(-len)
		.map(dateString => {
			const submiters = Object.entries(log[dateString])
				.map(entry => `**${config.register[entry[0]].username}**: ${entry[1]}%`)
				.join('\n')
			return `__${dateString}__\n${submiters}`
		})
		.forEach(day =>
			msg.channel.send(day).then(message => message.react('🗑️')));
	msg.reply(`Showing history for the last \`${len}\` days. React to a message to remove your entry from that day`);
}

function updateSleepStats(config, log) {
	Object.keys(config.register)
		.filter(id => !config.register[id].bot)
		.forEach(usrid => {
			const enteredDays = Object.values(log)
				.filter(day => Object.keys(day).includes(usrid));

			config.register[usrid].daysWon = enteredDays.reduce((acc, day) => winningIndicies(Object.values(day)).some(idx => Object.keys(day)[idx] == usrid) ? acc + 1 : acc,
				0);

			config.register[usrid].totalPercent = enteredDays
				.reduce((acc, day) => acc + day[usrid], 0);

			config.register[usrid].averagePercent = config.register[usrid].totalPercent / enteredDays.length;

			set({ config });
		});
}
function sendSleepStats({ msg, log, config }) {
	updateSleepStats(config, log);
	const stats = Object.keys(config.register)
		.filter(id => !config.register[id].bot)
		.map(id => `**${config.register[id].username}**:\n\t\tDays won: ${config.register[id].daysWon}\n\t\tTotal percent: ${config.register[id].totalPercent}%\n\t\tAverage percent: ${Math.round(config.register[id].averagePercent)}%`)
		.join('\n');

	msg.channel.send(`__Stats are looking like this:__\n${stats}`).then(reactOk);
	msg.delete();
}

function logSleep({ msg, log, config }) {
	const updateLog = (id, sleepString, percent) => {
		if (Object.keys(log).includes(sleepString)) {
			if (!Object.keys(log[sleepString]).includes(id)) {
				log[sleepString][id] = percent;
			} else { throw `You have already slept on ${sleepString}` }
		} else {
			log[sleepString] = { [id]: percent };
		}
		return log;
	}
	const getDate = () => {
		const parts = msg.content.split(' ');
		let days;
		if (parts.length == 2) {
			days = 1;
		} else if (parts.length == 3) {
			days = parseInt(parts[2]) || 1;
			if (!Number.isInteger(days)) { throw 'Please give an integer amount days ago' }
		} else if (parts.length == 5) {
			const date = new Date(parts.slice(2).join(' '));
			if (isNaN(Date.parse(date))) { throw 'Invalid date please use \`Jan 1 2000\`' }
			return date.toDateString();
		}
		let d = new Date();
		d.setDate(d.getDate() - days);
		return d.toDateString();
	}
	const calcFeedback = (percent) => {
		let scale = 0;
		if (percent >= 75) {
			scale = Math.floor(0.2 * percent - 12);
		} else if (percent >= 50) {
			scale = Math.floor(0.06666 * (percent + 1) - 2.3333);
		}
		return ([Object.keys(config.sleepResponses.feedback)[scale]
			, Object.values(config.sleepResponses.feedback)[scale]])
	}
	const getPercent = () => {
		if (msg.content.split("%").length - 1 !== 1) { throw 'Please include a (singular)\`%\`' }
		const percent = parseInt(msg.content //'slept 3%'
			.split('%')[0] //'slept 3'
			.slice(-3) //'t 3'
			.split(' ')//['t','3']
			.pop())//'3') 3
		if (percent < 0 || percent > 100 || !Number.isInteger(percent)) { throw 'Please give a valid (integer) percentage' }
		return percent;
	}

	const percent = getPercent();
	const dateString = getDate();

	log = updateLog(msg.author.id, dateString, percent);
	// const message = craftMessage();
	const [comment, question] = calcFeedback(percent);
	const unSubmited = Object.keys(config.register)
		.filter(id => id != msg.author.id &&
			!Object.keys(log[dateString]).includes(id) &&
			!config.register[id].bot)
		.map(id => `<@${id}>`)
		.join(', ');

	let pt2;
	if (unSubmited == '') {
		//reply who has won
		const indices = winningIndicies(Object.values(log[dateString]));
		const winner = indices
			.map(idx => `<@${Object.keys(log[dateString])[idx]}>`)
			.join(' and ');
		pt2 = `${winner} ha${indices.length > 1 ? 've' : 's'} won the day!`;
	} else {
		pt2 = `${unSubmited}, ${question}`;
	}
	msg.reply(`${comment}. ${pt2}`);
	set({ log });
}
////////////////////////////////////////////////////////////////////////////////

function define({ msg, config }) {
	const key = config.dictionaryapi.replace(/BRUH/g, '');
	const word = msg.content.replace(/define /, '');
	axios.get(`https://www.dictionaryapi.com/api/v3/references/collegiate/json/${word}?key=${key}`)
		.then(res => {
			//take the first definition and format it
			const log = res.data[0].shortdef
				.map(p => `\`\`\`${p};\`\`\``)
				.join('\n');
			msg.channel.send(`__${word}__:\n${log}`).then(reactOk);
		}).catch(err => { throw `Yea... that word dosn't exist` })
	updateStat(cnf => {
		cnf.register[msg.author.id].stats.definitions += 1;
		return cnf;
	}, 'config');
	msg.delete();
}



client.login(get('config').token.replace(/BRUH/g, ''));
