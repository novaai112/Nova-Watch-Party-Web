// node tests/game-chat-notes.test.js - the room chat keeps game "started" / "ended" notes, drops pause / resume notes
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../room.js', 'utf8');
const m = /const hiddenGameNote = m => (.*);\n/.exec(src); assert(m, 'hiddenGameNote not found');
const hidden = eval('(m => ' + m[1].replace(/^m =>\s*/, '') + ')');
const n = body => ({ kind: 'notice', body });
for (const b of ['Game paused', 'Game resumed', 'Game paused while the room admin changes']) assert(hidden(n(b)), b + ' should be hidden');
for (const b of ['Dinesh started Quick Trivia', 'Game ended · Winner: Dinesh', 'Game ended', 'Room is set to Public']) assert(!hidden(n(b)), b + ' should show');
assert(!hidden({ kind: 'chat', body: 'Game paused lol' }), 'a normal chat message is never hidden');
const sql = fs.readFileSync(__dirname + '/../room-games-schema.sql', 'utf8');
assert(!/_notice\([^;]*'Game (paused|resumed)/.test(sql) && !/Game paused while/.test(sql.replace(/--.*$/gm, '').replace(/body ~\*.*$/m, '')), 'server must not post pause/resume notes');
assert(/started '/.test(sql) && /'Game ended/.test(sql), 'start/end notes remain');
console.log('ok - game chat notes: only started / ended');
