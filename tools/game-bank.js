/* Nova Play question bank → room-games-bank.sql   (run: node tools/game-bank.js)
 * All questions are original / factual. Nothing here uses third-party images, audio or lyrics.
 * Add your own rows here (or insert into public.game_bank) and re-run; duplicates are skipped. */
const fs = require('fs'), path = require('path');
const T = []; const add = (cat, d, q, a, w) => T.push({ game: 'trivia', category: cat, difficulty: d, q: { kind: 'mcq', prompt: q, options: [a].concat(w), answer: a } });

/* ---- Quick Trivia : [category, difficulty, question, correct, [3 wrong]] ---- */
[
 ['General Knowledge','easy','How many days are there in a leap year?','366',['365','364','367']],
 ['General Knowledge','easy','Which is the largest ocean on Earth?','Pacific Ocean',['Atlantic Ocean','Indian Ocean','Arctic Ocean']],
 ['General Knowledge','easy','How many strings does a standard guitar have?','6',['4','5','7']],
 ['General Knowledge','medium','Which language has the most native speakers in the world?','Mandarin Chinese',['English','Spanish','Hindi']],
 ['General Knowledge','medium','Which animal is called the "Ship of the Desert"?','Camel',['Horse','Elephant','Donkey']],
 ['General Knowledge','hard','What is the smallest country in the world by area?','Vatican City',['Monaco','San Marino','Liechtenstein']],
 ['General Knowledge','hard','How many sides does a hexagon have?','6',['5','7','8']],
 ['Science','easy','Which planet is known as the Red Planet?','Mars',['Venus','Jupiter','Mercury']],
 ['Science','easy','Which gas do plants absorb from the air for photosynthesis?','Carbon dioxide',['Oxygen','Nitrogen','Hydrogen']],
 ['Science','medium','What is the chemical symbol for gold?','Au',['Ag','Gd','Go']],
 ['Science','medium','How many bones are there in an adult human body?','206',['196','212','250']],
 ['Science','hard','Which gas makes up most of Earth\'s atmosphere?','Nitrogen',['Oxygen','Carbon dioxide','Argon']],
 ['Science','hard','Approximately how fast does light travel in a vacuum?','300,000 km per second',['150,000 km per second','30,000 km per second','3,000,000 km per second']],
 ['Science','medium','What is the atomic number of hydrogen?','1',['2','8','10']],
 ['Technology','easy','What does CPU stand for?','Central Processing Unit',['Central Program Utility','Computer Personal Unit','Core Processing Utility']],
 ['Technology','easy','What does "www" stand for in a web address?','World Wide Web',['World Web Window','Wide World Web','Web World Wire']],
 ['Technology','medium','What does HTML stand for?','HyperText Markup Language',['HyperTool Multi Language','High Text Machine Language','Hyperlink and Text Management Language']],
 ['Technology','medium','Which language is mainly used to style web pages?','CSS',['HTML','Python','SQL']],
 ['Technology','hard','Which data structure works on a first-in, first-out (FIFO) basis?','Queue',['Stack','Tree','Heap']],
 ['Technology','hard','What does SSD stand for?','Solid State Drive',['Super Speed Disk','Secure Storage Device','Serial System Drive']],
 ['Technology','medium','Who is credited with inventing the World Wide Web?','Tim Berners-Lee',['Bill Gates','Steve Jobs','Linus Torvalds']],
 ['Movies','easy','Which animated film features a lion cub named Simba?','The Lion King',['Madagascar','Jungle Book','Tarzan']],
 ['Movies','easy','Who directed the 1997 film Titanic?','James Cameron',['Steven Spielberg','Christopher Nolan','Ridley Scott']],
 ['Movies','medium','In The Matrix, which colour pill does Neo choose?','Red',['Blue','Green','Yellow']],
 ['Movies','medium','Which film won the Best Picture Oscar for 2019 films (awarded in 2020)?','Parasite',['1917','Joker','Ford v Ferrari']],
 ['Movies','hard','Which Indian film\'s song "Naatu Naatu" won an Oscar?','RRR',['Pushpa','Baahubali 2','Dangal']],
 ['Movies','hard','Which Christopher Nolan film is about stealing ideas from dreams?','Inception',['Interstellar','Tenet','Memento']],
 ['Movies','medium','Who played Jack Sparrow in Pirates of the Caribbean?','Johnny Depp',['Orlando Bloom','Brad Pitt','Tom Cruise']],
 ['Anime','easy','In Naruto, what is Naruto\'s dream?','To become the Hokage',['To become a samurai','To be the Pirate King','To find the Dragon Balls']],
 ['Anime','easy','Which anime hero wears a straw hat and wants to be King of the Pirates?','Monkey D. Luffy',['Naruto Uzumaki','Ichigo Kurosaki','Edward Elric']],
 ['Anime','medium','Which studio produced Spirited Away?','Studio Ghibli',['Madhouse','Bones','Toei Animation']],
 ['Anime','medium','In Dragon Ball Z, Goku belongs to which race?','Saiyan',['Namekian','Human','Majin']],
 ['Anime','hard','In Death Note, what is the name of Light\'s Shinigami?','Ryuk',['Rem','Gelus','Sidoh']],
 ['Anime','hard','Who is the author of the manga One Piece?','Eiichiro Oda',['Masashi Kishimoto','Akira Toriyama','Hajime Isayama']],
 ['Anime','easy','In Attack on Titan, what are the giant humanoid creatures called?','Titans',['Giants','Colossals','Ogres']],
 ['Sports','easy','In which sport would you perform a slam dunk?','Basketball',['Volleyball','Tennis','Handball']],
 ['Sports','easy','How many players from one team play on the field in cricket?','11',['9','10','12']],
 ['Sports','medium','Which country won the FIFA World Cup in 2022?','Argentina',['France','Brazil','Croatia']],
 ['Sports','medium','How many Grand Slam tournaments are held in tennis each year?','4',['3','5','6']],
 ['Sports','hard','Which city hosted the 2016 Summer Olympics?','Rio de Janeiro',['London','Tokyo','Beijing']],
 ['Sports','hard','In golf, what is a score of one under par on a hole called?','Birdie',['Eagle','Bogey','Albatross']],
 ['Sports','medium','How many rings are there in the Olympic symbol?','5',['4','6','7']],
 ['History','easy','Who was the first President of the United States?','George Washington',['Abraham Lincoln','Thomas Jefferson','John Adams']],
 ['History','easy','Which ancient civilisation built the pyramids of Giza?','Egyptians',['Romans','Greeks','Mayans']],
 ['History','medium','In which year did World War II end?','1945',['1939','1944','1950']],
 ['History','medium','Who is known as the Father of the Nation in India?','Mahatma Gandhi',['Jawaharlal Nehru','Subhas Chandra Bose','Bhagat Singh']],
 ['History','hard','In which year did the Berlin Wall fall?','1989',['1991','1987','1985']],
 ['History','hard','Which Mughal emperor built the Taj Mahal?','Shah Jahan',['Akbar','Babur','Aurangzeb']],
 ['History','medium','Which empire was ruled by Julius Caesar?','Roman Empire',['Greek Empire','Ottoman Empire','Persian Empire']],
 ['Geography','easy','What is the capital of France?','Paris',['Lyon','Marseille','Nice']],
 ['Geography','easy','On which continent is Egypt located?','Africa',['Asia','Europe','South America']],
 ['Geography','medium','What is the capital of Australia?','Canberra',['Sydney','Melbourne','Perth']],
 ['Geography','medium','Which is the largest country in the world by area?','Russia',['Canada','China','United States']],
 ['Geography','hard','Which river flows through Paris?','Seine',['Thames','Rhine','Danube']],
 ['Geography','hard','Mount Everest lies on the border of Nepal and which country?','China',['India','Bhutan','Pakistan']],
 ['Geography','medium','What is the capital of Canada?','Ottawa',['Toronto','Vancouver','Montreal']],
 ['Music','easy','How many keys does a standard piano have?','88',['76','92','100']],
 ['Music','easy','Which band was John Lennon a member of?','The Beatles',['The Rolling Stones','Queen','Pink Floyd']],
 ['Music','medium','Which singer is known as the "King of Pop"?','Michael Jackson',['Elvis Presley','Prince','Justin Bieber']],
 ['Music','medium','Who composed the "Moonlight Sonata"?','Beethoven',['Mozart','Bach','Chopin']],
 ['Music','hard','Which musical term means "gradually getting louder"?','Crescendo',['Diminuendo','Staccato','Legato']],
 ['Music','hard','A. R. Rahman won two Oscars for which film?','Slumdog Millionaire',['Lagaan','Roja','Bombay']],
 ['Music','medium','How many strings does a violin have?','4',['5','6','3']]
].forEach(r => add(...r));

/* ---- Guess the Movie : clue types description / actor / scene / emoji / mcq ---- */
const M = [];
const mv = (cat, d, prompt, answer, accept, emoji, options) => M.push({ game: 'movie', category: cat, difficulty: d, q: Object.assign({ kind: options ? 'mcq' : 'text', prompt, answer, accept: accept || [] }, emoji ? { emoji } : {}, options ? { options: [answer].concat(options) } : {}) });
mv('description','easy','A young lion cub is tricked into believing he caused his father\'s death and runs away from his kingdom.','The Lion King',[]);
mv('description','easy','A toy cowboy feels threatened when a shiny new space ranger toy arrives in his owner\'s room.','Toy Story',[]);
mv('description','medium','A skilled thief enters people\'s dreams to plant an idea in a powerful CEO\'s mind.','Inception',[]);
mv('description','medium','A boy learns on his eleventh birthday that he is a wizard and is invited to a school of magic.','Harry Potter and the Philosopher\'s Stone',['harry potter','harry potter and the sorcerers stone','sorcerers stone']);
mv('description','hard','Three friends at a top engineering college challenge rote learning, guided by the motto "All is well".','3 Idiots',['three idiots']);
mv('actor','easy','Character clue: Jack Dawson, a poor artist who wins a ticket aboard a famous ship.','Titanic',[]);
mv('actor','medium','Character clue: Tony Stark builds a powered suit of armour after being captured in a cave.','Iron Man',['ironman']);
mv('actor','hard','Character clue: Vito Corleone, the head of a powerful New York crime family.','The Godfather',['godfather']);
mv('scene','easy','Famous scene: a giant shark terrorises a beach town and the police chief says they will need a bigger boat.','Jaws',[]);
mv('scene','medium','Famous scene: a masked vigilante in a bat suit interrogates a laughing clown in a police interrogation room.','The Dark Knight',['dark knight']);
mv('scene','hard','Famous scene: a boy on a bicycle flies across the face of the moon with an alien in his basket.','E.T. the Extra-Terrestrial',['et','e t','et the extra terrestrial','extra terrestrial']);
mv('emoji','easy','Guess the movie from the emoji.','Spider-Man',['spiderman','spider man'],'🕷️🕸️🏙️');
mv('emoji','medium','Guess the movie from the emoji.','The Lord of the Rings',['lord of the rings','lotr'],'🧙‍♂️💍🌋');
mv('emoji','hard','Guess the movie from the emoji.','Finding Nemo',['nemo'],'🐠🔍🌊');
mv('mcq','easy','In which film does a snowman named Olaf appear?','Frozen',[], '', ['Moana','Tangled','Brave']);
mv('mcq','medium','Which film follows a clownfish named Marlin searching for his son?','Finding Nemo',[], '', ['Shrek','Moana','Cars']);

/* ---- Emoji Challenge : movie / character / song / phrase ---- */
const E = [];
const em = (cat, d, emoji, answer, accept, decoys) => E.push({ game: 'emoji', category: cat, difficulty: d, q: { kind: 'text', prompt: 'Guess the ' + cat + ' from the emoji.', emoji, answer, accept: accept || [], options: [answer].concat(decoys) } });
em('movie','easy','🦁👑','The Lion King',[],['Madagascar','Tarzan','Jungle Book']);
em('movie','easy','🧊👸❄️','Frozen',[],['Tangled','Brave','Moana']);
em('movie','easy','🦇🧔🌃','Batman',[],['Superman','Spider-Man','Iron Man']);
em('movie','medium','🚢🧊💔','Titanic',[],['Poseidon','Jaws','Moana']);
em('movie','medium','🧙‍♂️💍🌋','The Lord of the Rings',['lord of the rings','lotr'],['Harry Potter','The Hobbit','Narnia']);
em('movie','medium','🤖❤️🌱','WALL-E',['wall e','walle'],['Big Hero 6','Cars','Robots']);
em('movie','medium','🐼🥋','Kung Fu Panda',[],['Madagascar','Rio','Ice Age']);
em('movie','hard','🦈🌊😱','Jaws',[],['Finding Nemo','Deep Blue Sea','Moana']);
em('movie','hard','👻🚫📞','Ghostbusters',[],['Casper','Scream','Poltergeist']);
em('character','easy','🧙‍♂️⚡','Harry Potter',[],['Gandalf','Dumbledore','Merlin']);
em('character','easy','🕷️🧑','Spider-Man',['spiderman','spider man'],['Batman','Ant-Man','Superman']);
em('character','medium','🧞‍♂️🪔','Aladdin',['genie'],['Sinbad','Ali Baba','Jafar']);
em('character','medium','🐭🏰','Mickey Mouse',['mickey'],['Stuart Little','Jerry','Ratatouille']);
em('character','hard','🔨⚡👱','Thor',[],['Hercules','Zeus','Loki']);
em('song','easy','🎂🎉🎈','Happy Birthday',['happy birthday to you'],['Celebration','Party Rock','Birthday']);
em('song','easy','⭐✨🌟','Twinkle Twinkle Little Star',['twinkle twinkle','twinkle'],['Starboy','Shine On','Star Shopping']);
em('song','medium','🎅🛷🔔','Jingle Bells',[],['Silent Night','Deck the Halls','Joy to the World']);
em('song','medium','☂️🌧️','Umbrella',[],['Singing in the Rain','Purple Rain','Rain on Me']);
em('song','hard','🚣🌊🎶','Row Row Row Your Boat',['row your boat'],['Sailing','Riptide','Drift Away']);
em('phrase','easy','🍰🚶','Piece of cake',['a piece of cake'],['Cake walk','Eat cake','Sweet tooth']);
em('phrase','medium','🌧️🐱🐶','Raining cats and dogs',[],['Cat and mouse','Dog days','Pouring rain']);
em('phrase','medium','🐘🏠','Elephant in the room',['the elephant in the room'],['Big house','Bull in a china shop','White elephant']);
em('phrase','hard','🌙🔵','Once in a blue moon',[],['Over the moon','Blue sky thinking','Moonlight shadow']);
em('phrase','hard','🧊🔨','Break the ice',[],['Cold feet','On thin ice','Ice cold']);

/* ---- Guess the Song : lyric-free descriptions; [clue, title, artist, title decoys, artist decoys, difficulty] ---- */
const S = [];
const sg = (d, clue, title, artist, td, ad) => S.push({ game: 'song', category: 'pop', difficulty: d, q: { kind: 'mcq', prompt: clue, title, artist, titleOptions: [title].concat(td), artistOptions: [artist].concat(ad) } });
sg('easy','A 1987 pop hit whose music video became the origin of an internet prank.','Never Gonna Give You Up','Rick Astley',['Together Forever','Take On Me','Careless Whisper'],['Michael Jackson','a-ha','George Michael']);
sg('easy','A 2012 K-pop song with a viral horse-riding dance that was the first YouTube video to pass one billion views.','Gangnam Style','PSY',['Gentleman','Fantastic Baby','Dynamite'],['BTS','BIGBANG','Super Junior']);
sg('easy','A 2017 Spanish-language smash that topped charts worldwide with a reggaeton beat.','Despacito','Luis Fonsi ft. Daddy Yankee',['Mi Gente','Bailando','Havana'],['Shakira','J Balvin','Enrique Iglesias']);
sg('medium','A 1975 rock epic with an operatic middle section and no real chorus, famous from a movie headbanging scene.','Bohemian Rhapsody','Queen',['Stairway to Heaven','Hotel California','Dream On'],['Led Zeppelin','The Eagles','Aerosmith']);
sg('medium','A 2015 comeback single from a British singer that begins with a phone call.','Hello','Adele',['Someone Like You','Skyfall','Rolling in the Deep'],['Sam Smith','Dua Lipa','Lana Del Rey']);
sg('medium','A 2009 song by an Indian composer from a film about a Mumbai game-show contestant, which won an Oscar.','Jai Ho','A. R. Rahman',['Kun Faya Kun','Chaiyya Chaiyya','Vande Mataram'],['Pritam','Shankar-Ehsaan-Loy','Amit Trivedi']);
sg('medium','A 2014 funk-pop hit that asks you to look good tonight, from a producer and a Hawaiian-born singer.','Uptown Funk','Mark Ronson ft. Bruno Mars',['Treasure','Happy','Get Lucky'],['Pharrell Williams','Justin Timberlake','Daft Punk']);
sg('hard','A 2015 tribute song for a film franchise, performed by a rapper and a singer-songwriter.','See You Again','Wiz Khalifa ft. Charlie Puth',['Lean On','Sugar','Roar'],['Drake','Post Malone','Bruno Mars']);
sg('hard','A 1982 title track whose music video features a famous zombie dance.','Thriller','Michael Jackson',['Bad','Beat It','Smooth Criminal'],['Prince','Lionel Richie','Stevie Wonder']);
sg('easy','A 2013 upbeat song that says it is all about being happy and was nominated for an Oscar.','Happy','Pharrell Williams',['Get Lucky','Shake It Off','Can\'t Stop the Feeling'],['Bruno Mars','Justin Timberlake','Ed Sheeran']);
sg('medium','A 2017 acoustic pop hit about falling for someone\'s curves, with a looping marimba-style riff.','Shape of You','Ed Sheeran',['Perfect','Thinking Out Loud','Photograph'],['Shawn Mendes','Harry Styles','Sam Smith']);

/* ---- Would You Rather ---- */
const W = []; const wy = (a, b) => W.push({ game: 'wyr', category: 'fun', difficulty: 'easy', q: { kind: 'poll', prompt: 'Would you rather…', options: [a, b] } });
wy('Watch movies every day','Play games every day');
wy('Always be 10 minutes early','Always be 10 minutes late');
wy('Have the ability to fly','Have the ability to be invisible');
wy('Live in the mountains','Live by the beach');
wy('Only eat pizza for a year','Only eat burgers for a year');
wy('Rewatch your favourite movie forever','Never watch the same movie twice');
wy('Travel to the past','Travel to the future');
wy('Be a famous actor','Be a famous musician');
wy('Have unlimited movie tickets','Have unlimited game credits');
wy('Watch every film with subtitles','Watch every film dubbed');
wy('Know how every movie ends','Never know how anything ends');
wy('Have a pet dragon','Have a pet unicorn');
wy('Live without music','Live without movies');
wy('Always have to sing instead of speaking','Always have to dance instead of walking');
wy('Binge a whole series in one night','Watch one episode a day');
wy('Be the hero of an action movie','Be the star of a comedy');

const all = [].concat(T, M, E, S, W);
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
let sql = '-- Nova Play question bank (generated by tools/game-bank.js) — safe to re-run; duplicates are skipped.\n-- Needs room-games-schema.sql first.\n';
sql += 'insert into public.game_bank(game, category, difficulty, q) values\n' + all.map(r => '(' + [q(r.game), q(r.category), q(r.difficulty), q(JSON.stringify(r.q)) + '::jsonb'].join(', ') + ')').join(',\n') + '\non conflict do nothing;\n';
sql += "\nnotify pgrst, 'reload schema';\n";
fs.writeFileSync(path.join(__dirname, '..', 'room-games-bank.sql'), sql);
console.log('questions:', all.length, '→ room-games-bank.sql');
