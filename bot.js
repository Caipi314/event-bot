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

client.on('message', msg => {
	if (msg.author == client.user) { return }

	let fn;
	//event bot
	if (msg.content.startsWith('event clear')) { fn = clear }
	else if (msg.content.startsWith('event time')) { fn = time }
	else if (msg.content.startsWith('event future')) { fn = future }
	else if (msg.content.startsWith('event presets')) { fn = sendPresets }
	else if (msg.content.startsWith('event ')) { fn = createEvent }
	else if (msg.content.startsWith('meeting ')) { fn = createEvent }
	else if (msg.content.startsWith('call ')) { fn = createEvent }
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
	if (Object.keys(config.presets).indexOf(msg.content.toLowerCase()) !== -1) {
		isKeyword();
	} else if (config.noYouSpellings.some(word => msg.content.includes(word))) {
		isNoU();
	} else { return }
}


function deleteMessage(channel, id) {
	channel.messages
		.fetch(id)
		.then(message => message.delete());
}

function isRSVP(reaction, user, added) {
	const updateAttendies = (event, reaction) => {
		reaction.message.reactions.removeAll();
		reaction.message.react('👍');
		reaction.message.react('👎');
		reaction.message.react('❌');


		const config = get('config');
		let attendies = Object.keys(event.people)
			.filter(id => event.people[id] !== null)
			.map(id => {
				const emojiObj = event.people[id] ?
					config.register[id].emoji.happy :
					config.register[id].emoji.sad;
				return `<:${emojiObj.name}:${emojiObj.id}>`;
			})
			.join('     ');
		attendies == '' ? attendies = '*No attendies yet...*' : 0;

		reaction.message.channel.messages.fetch(event.messages.guestList)
			.then(message => message.edit(attendies));
	}
	const sendSass = (user) => {
		const config = get('config');
		const message = config.responses[Math.floor(Math.random() * config.responses.length)];
		user.send(message);
	}
	const events = get('events');

	//if message is not sent by the bot / title is invalid / person isnt invited
	if (reaction.message.author.id != client.user.id) { return }
	const title = reaction.message.content.split('**')[1];
	if (events[title] === undefined) { throw 'Hmm... something went wrong' }
	if (!(Object.keys(events[title].people).includes(user.id))) { throw 'You are not part of the event 😢' }

	if (reaction.emoji.name == '👍') {
		events[title].people[user.id] = added ? true : null;
		updateAttendies(events[title], reaction);
	} else if (reaction.emoji.name == '👎') {
		events[title].people[user.id] = added ? false : null;
		sendSass(user);
		updateAttendies(events[title], reaction);
	} else if (reaction.emoji.name == '❌') {
		if (events[title].creator != user.id) { throw (added ? `${user}, You cannot delete someone else's event!` : `${user} the damage was already done bud`) }

		Object.values(events[title].messages).forEach(msgId =>
			deleteMessage(reaction.message.channel, msgId));
		delete events[title];
	} else { return }


	set({ events });
	updateStat(cnf => {
		cnf.register[user.id].stats.eventsAttended += 1;
		return cnf;
	}, 'config');
}
function isDeleteDay(reaction, user, added) {
	if (!added) { return }
	const log = get('log');
	const config = get('config');

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

	sendDelete(`${usr}, Your entry for **${date}** day has been removed`, reaction.message);
}

function messageReaction(reaction, user, added) {
	if (user == client.user) { return }

	let fn;
	if (['👍', '👎', '❌'].includes(reaction.emoji.name)) { fn = isRSVP }
	else if ('🗑' == reaction.emoji.name) { fn = isDeleteDay }
	else { return }

	try {
		fn(reaction, user, added);
	} catch (err) {
		reaction.message.channel.send(`❗${err}❗`);
		console.log(err);
	}
}
client.on('messageReactionAdd', (r, u) => messageReaction(r, u, true));
client.on('messageReactionRemove', (r, u) => messageReaction(r, u, false));

function updateRegister() {
	const config = get('config');
	client.guilds.cache.get(config.guilds[0]).members.cache
		.forEach(({ user: { id, username, discriminator, bot } }) => {
			if (Object.keys(config.register).includes(id)) {
				config.register[id].username = username;
				config.register[id].bot = bot;
				config.register[id].discriminator = discriminator;
			} else {
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
}
function sendTp2(event) {
	const config = get('config');
	Object.keys(event.people)
		.filter(id => event.people[id] === true)
		.forEach(id => {
			const user = client.guilds.cache.get(config.guilds[0]).members.cache.get(id);
			if (user !== undefined && user.voice.channel) {
				//user isn't cached OR user isn't connected
				user.send(`You're late to your meeting called **${event.title}**`);
			}

		})
}
function sendTm0(event) {
	Object.entries(event.people)
		.filter((entry) => entry[1] !== false)
		.forEach(async ([id, status]) =>
			(await client.users
				.fetch(id))
				.send(get('config').reminder[JSON.stringify(status)] + event.title)
		);
}
function sendTm15(event) {
	Object.keys(event.people)
		.filter(id => event.people[id] == null)
		.forEach(async id =>
			(await client.users
				.fetch(id))
				.send(`You have not responded to a discord meeting taking place in 15 minutes titled **${event.title}**!`));
}
client.on('ready', () => {
	const isMinsFromNow = (mins, event) => {
		return new Date >= new Date(event.date) - (60 * 1000 * mins)
	}

	console.log(`Logged in as ${client.user.tag}`);
	client.user.setActivity('Unlimited POWAHH');

	setInterval(() => {
		updateRegister();
		const events = get('events');

		Object.values(events).forEach(event => {
			if (isMinsFromNow(-2, event) && !event.reminders.tp2) {
				sendTp2(event);
				events[event.title].reminders.tp2 = true;
				delete events[event.title];
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
client.login(get('config').token.replace(/BRUH/g, ''));

function sendDebug({ msg }) {
	let file;
	if (msg.content.endsWith('config')) { file = 'config' }
	else if (msg.content.endsWith('events')) { file = 'events' }
	else if (msg.content.endsWith('log')) { file = 'log' }
	else { throw 'Valid files are \`events\`, \`config\`, \`log\`' }

	msg.channel.send(`\`${JSON.stringify(get(file), null, 2)}\``)
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

	msg.channel.send(help);
}

function sendPresets({ msg, config }) {
	const presets = Object.entries(config.presets)
		.map(([keyWord, time]) => `\t\`${keyWord}\`  :  \`${time}\``)
		.join('\n');
	msg.channel.send(`__Presets include:__\n${presets}`);
}
function createEvent({ msg, config, events }) {
	const getDate = () => {
		const offset = (process.env._ && process.env._.indexOf("heroku") ? 5 : 0) + (config.dateOps[1].hour12 ? 12 : 0);
		const today = new Date();
		let input;
		if (msg.content.includes(':')) {
			input = msg.content.split(' ').filter(x => x.match(/:/g))[0];
		} else {
			input = msg.content
				.split(' ')
				.filter(word => Object.keys(config.presets).includes(word))[0];
			input = config.presets[input];
			if (input === undefined) { throw 'Please provide a valid time or preset' }
		}


		if (input.split('-').length == 3) { // its in this format
			input = `${today.getFullYear()}-${input}`;
			const dateObj = new Date(input);
			dateObj.setTime(dateObj.getTime() + (offset * 60 * 60 * 1000));
			return dateObj;
		} else {
			const hours = parseInt(input.split(':')[0]) + offset;
			const minutes = parseInt(input.split(':')[1]);
			const date = new Date(
				today.getFullYear(),
				today.getMonth(),
				today.getDate(),
				hours,
				minutes
			);
			if (isNaN(date.getTime())) { throw 'Invalid time' }
			else if (today > date) { throw 'Date is in the past' }
			return date;
		}
	}
	const getPeople = () => {
		let mentions = msg.mentions.users.map(user => user.id);
		if (mentions.length == 0) {
			mentions = Object.keys(config.register)
				.filter(id => !config.register[id].bot)
		}
		//add the author if not their
		mentions.indexOf(msg.author.id) == -1 ? mentions.push(msg.author.id) : 0;
		// each user is defaulted to null status
		return mentions.reduce((acc, usr) => {
			acc[usr] = null; return acc
		}, {});
	}
	const getTitle = () => {
		let title = msg.content
			.split(' ')
			.slice(msg.mentions.users.size + 2) //+2 for 'time' and 'event'
			.join(' ')
			.replace('**', '');
		title.length == 0 ? title = 'Untitled Event' : 0;
		while (Object.keys(events).includes(title)) { title += '!'; }
		return title;
	}
	const sendConfimation = (event) => {
		const displayDate = event.date.toLocaleTimeString(...config.dateOps);
		const displayNames = Object.keys(event.people)
			.map(x => `<@${x}>`)
			.join(', ');
		const data = `**${event.title}** created for **${displayDate}**\n${displayNames} are invited\nRespond to this message to mark your availability`;
		msg.channel.send(data)
			.then(message => {
				message.react('👍');
				message.react('👎');
				message.react('❌');
				updateStat(evts => {
					evts[event.title].messages.readback = message.id; return evts;
				}, 'events');
			});

		msg.channel.send('*No attendies yet...*')
			.then(message => {
				updateStat(evts => {
					evts[event.title].messages.guestList = message.id; return evts;
				}, 'events');
			});

	}
	const event = {};
	event.title = getTitle();
	event.date = getDate();
	event.creator = msg.author.id;
	event.people = getPeople();
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
	}, 'config')

}

function clear({ msg, events }) {
	const parts = msg.content.split(' ');
	if (parts[2] !== undefined) {//clear event title
		const requestedTitle = parts.slice(2, parts.length).join(' ');
		if (Object.keys(events).includes(requestedTitle)) {
			delete events[requestedTitle]
			sendDelete(`Event titled **${requestedTitle}** has been deleted`, msg)
		} else { throw `No event titled **${requestedTitle}**` }
	} else {//clear
		events = {};
		sendDelete(`All events cleared`, msg);
	}
	set({ events });
}
function time({ msg, config }) {
	if (msg.content == 'event timetoggle') {
		config.dateOps[1].hour12 = !(config.dateOps[1].hour12);
		set({ config });
	}
	sendDelete(`**${config.dateOps[1].hour12 ? '12' : '24'}** Hour time is now active`, msg);
}

function future({ msg, config, events }) {
	if (Object.keys(events).length == 0) { throw 'No upcoming events 😢' }
	//TODO
	//if noone has responde INVITATIONS ARE SENT
	//If everyone has responded ITS GONNA BE A PARTY
	const calender = Object.values(events)
		.map(event => {
			const date = new Date(event.date);
			const dateString = date.toLocaleTimeString(...config.dateOps);
			const people = Object.entries(event.people)
				.map(([id, status]) => `\t\t\t**${config.register[id].username}** ${config.statuses[JSON.stringify(status)]}`)
				.join('\n');
			return `👉  **${event.title}** is happening at **${dateString}**, attendance:\n${people}`;
		}).join('\n');
	msg.channel.send(`__Upcoming events:__\n${calender}`)

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

	msg.channel.send(`__Stats are looking like this:__\n${stats}`);
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
			try {
				//take the first definition and format it
				const log = res.data[0].shortdef
					.map(p => `\`\`\`${p};\`\`\``)
					.join('\n');
				msg.channel.send(`__${word}__:\n${log}`);
			} catch (e) { throw `Yea... that word dosn't exist` }
		})
	updateStat(cnf => {
		cnf.register[msg.author.id].stats.definitions += 1;
		return cnf;
	}, 'config');

}