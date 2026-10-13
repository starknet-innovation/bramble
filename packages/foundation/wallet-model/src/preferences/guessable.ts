/**
 * Common-password check behind the setup strength meter (Sherlock 152).
 *
 * The meter's entropy estimate credits every character as if it were random,
 * so "Password1" read fair and "p@ssw0rd2024" read strong. An offline guesser
 * tries exactly these first. This module recognises them: a common password
 * with case, leet substitutions and leading or trailing digits and symbols
 * folded away; a value that repeats one chunk; and a keyboard or alphabet run.
 * A match makes the meter read weak. Feedback only, never a gate: acceptance
 * stays with the length floor.
 *
 * Word list: the first 2,000 distinct folded words of SecLists
 * Passwords/Common-Credentials/10k-most-common.txt (Daniel Miessler, MIT
 * licence, commit 97e8798d). Each entry was lower-cased, leet-folded and
 * stripped of digits and symbols; words under four letters were dropped.
 */

const COMMON_WORDS = [
  "password qwerty dragon pussy baseball football letmein monkey mustang michael shadow",
  "master jennifer jordan superman harley fuckme hunter fuckyou trustno ranger buster",
  "thomas tigger robert soccer fuck batman test pass killer hockey george charlie andrew",
  "michelle love sunshine jessica asshole pepper daniel access joshua maggie starwars",
  "silver william dallas yankees ashley hello amanda orange biteme freedom computer sexy",
  "thunder nicole ginger heather hammer summer corvette taylor fucker austin merlin matthew",
  "golfer cheese princess martin chelsea patrick richard diamond yellow bigdog secret",
  "asdfgh sparky cowboy camaro anthony matrix falcon iloveyou bailey guitar jackson purple",
  "scooter phoenix aaaaaa morgan tigers porsche mickey maverick cookie nascar peanut justin",
  "money horny samantha panties steelers joseph snoopy boomer whatever iceman smokey",
  "gateway dakota cowboys eagles chicken dick black zxcvbn please andrea ferrari knight",
  "hardcore melissa compaq coffee booboo bitch johnny bulldog xxxxxx welcome james player",
  "wizard scooby charles junior internet bigdick mike brandy tennis blowjob banana monster",
  "spider lakers miller rabbit enter mercedes brandon steven fender john yamaha diablo",
  "chris boston tiger marine chicago rangers gandalf winter bigtits barney edward raiders",
  "porn badboy blowme spanky bigdaddy johnson chester london midnight blue fishing hannah",
  "slayer rachel sexsex redsox asdf marlboro panther zxcvbnm arsenal oliver qazwsx mother",
  "victoria jasper angel david winner crystal golden butthead viking jack iwantu shannon",
  "murphy angels prince cameron girls madison wilson carlos hooters willie startrek captain",
  "maddog jasmine butter booger angela golf lauren rocket tiffany theman dennis liverpoo",
  "flower forever green jackie muffin turtle sophie danielle redskins toyota jason sierra",
  "winston debbie giants packers newyork jeremy casper bubba sandra lovers mountain united",
  "cooper driver tucker helpme fucking pookie lucky maxwell bear suckit gators shithead",
  "fuckoff jaguar monica fred happy hotdog tits gemini lover xxxxxxxx canada nathan victor",
  "florida nicholas rosebud metallic doctor trouble success stupid tomcat warrior peaches",
  "apples fish qwertyui magic buddy dolphins rainbow gunner freddy alexis braves cock",
  "cocacola xavier dolphin testing bond member calvin voodoo samson alex apollo fire tester",
  "walter beavis voyager peter porno bonnie rush beer apple scorpio jonathan skippy sydney",
  "scott power gordon travis beaver star jackass flyers boobs zzzzzz steve rebecca scorpion",
  "doggie legend yankee blazer bill runner birdie bitches parker topgun asdfasdf heaven",
  "viper animal bigboy arthur baby private godzilla donald williams lifehack phantom dave",
  "rock august sammy cool brian platinum jake bronco paul mark frank hekaw copper billy",
  "cumshot garfield willow cunt little carter slut albert kitten super eagle shelby america",
  "jessie house free chevy bullshit white broncos horney surfer nissan saturn airborne",
  "elephant marvin shit action adidas qwert kevin explorer walker police christin december",
  "benjamin wolf sweet therock king online dickhead brooklyn teresa cricket sharon dexter",
  "racing penis gregory teens redwings dreams michigan hentai magnum nothing donkey trinity",
  "digital stella cartman guinness speedy buffalo kitty pimpin einstein kelly nelson",
  "nirvana vampire xxxx playboy louise pumpkin snowball girl sucker mexico beatles fantasy",
  "ford gibson celtic marcus cherry cassie natasha sniper chance genesis hotrod reddog",
  "alexande college jester bigcock smith lasvegas carmen slipknot death kimberly qwee",
  "eclipse qweear stanley samuel drummer homer montana music aaaa spencer jimmy carolina",
  "colorado creative rocky goober friday bollocks scotty abcdef bubbles hawaii fluffy mine",
  "stephen horses thumper pussies darkness asdfghjk pamela boobies buddha vanessa sandman",
  "naughty douglas honda matt azerty shorty beach loveme simple poohbear badass destiny",
  "sarah denise vikings lizard melanie assman sabrina nintendo water good howard time",
  "november xxxxx october leather bastard young extreme hard vincent lacrosse hotmail",
  "spooky amateur alaska badger paradise maryjane poop crazy mozart video russell vagina",
  "spitfire anderson norman eric cherokee cougar barbara long family horse enigma allison",
  "raider brazil blonde jones dude drowssap jeff school marshall lovely jeffrey caroline",
  "franklin booty molly snickers leslie nipples courtney diesel rocks eminem westside",
  "suzuki daddy passion hummer ladies zachary frankie elvis reggie alpha suckme simpson",
  "patricia pirate tommy semperfi jupiter redrum freeuser wanker stinky ducati paris",
  "natalie babygirl bishop windows spirit pantera monday patches brutus houston smooth",
  "penguin marley forest cream flash maximus nipple bobby bradley vision pokemon champion",
  "fireman indian softball picard system clinton cobra enjoy claire claudia boogie timothy",
  "marines security dirty admin wildcats pimp dancer hardon veronica fucked abcd abcdefg",
  "ironman wolverin remember great freepass bigred squirt justice francis hobbes kermit",
  "pearljam mercury domino denver brooke rascal hitman mistress simon tony bbbbbb friend",
  "peekaboo naked budlight electric sluts stargate saints bondage brittany bigman zombie",
  "swimming duke babes scotland disney rooster brenda mookie swordfis candy duncan olivia",
  "hunting blink alicia samsung whore virginia general passport aaaaaaaa erotic liberty",
  "arizona jesus newport skipper rolltide balls galore christ weasel wombat digger classic",
  "bulldogs poopoo accord popcorn turkey jenny amber bunny mouse titanic liverpool dreamer",
  "everton friends chevelle carrie gabriel psycho nemesis burton pontiac connor eatme",
  "lickme roland cumming mitchell ireland lincoln arnold spiderma patriots goblue devils",
  "eugene empire asdfg cardinal brown shaggy froggy qwer kawasaki kodiak people phpbb light",
  "kramer chopper hooker honey whynot lesbian lisa baxter adam snake teen nccitoid qqqqqq",
  "airplane britney avalon sandy sugar sublime stewart wildcat raven scarface elizabet",
  "trucks wolfpack pervert lawrence raymond redhead american alyssa bambam movie woody",
  "shaved snowman chicks raptor stingray shooter france stars madmax kristen sports jerry",
  "garcia simpsons lights ryan looking chronic alison hahaha packard hendrix perfect",
  "service spring srinivas spike katie oscar brother bigmac suck single cannon georgia",
  "popeye tattoo texas party bullet taurus sailor wolves panthers japan strike flowers",
  "pussycat loverboy berlin sticky marina tarheels fisher russia connie wolfgang testtest",
  "mature bass catch juice nigger women trooper hawkeye head freaky dodgers pakistan",
  "machine pyramid vegeta katana moose tinker coyote infinity inside pepsi bang control",
  "hercules morris tickle outlaw browns billybob pickle michele antonio sucks pavilion",
  "changeme caesar prelude tanner adrian darkside bowling wutang sunset robbie alabama",
  "danger zeppelin juan rusty pppppp nick ping darkstar madonna bigone casino cheryl mmmmmm",
  "integra wrangler apache tweety bobafett simone none business sterling trevor transam",
  "dustin harvey england seattle ssssss rose harry openup pandora pussys trucker wallace",
  "indigo storm malibu weed review babydoll doggy dilbert pegasus joker catfish flipper",
  "valerie herman fuckit detroit kenneth cheyenne bruins stacey smoke joey seven marino",
  "fetish xfiles wonder stinger pizza babe pretty stealth manutd gracie gundam cessna",
  "longhorn presario mnbvcxz wicked victory shelly awesome athena qiweer help holiday",
  "knicks street redneck casey gizmo scully devildog triumph eddie bluebird shotgun peewee",
  "ronnie daisy special metallica madman country impala lennon roscoe omega enterpri",
  "miranda search smitty blizzard unicorn tight rick ronald harrison trigger truck danny",
  "home winnie beauty thailand cadillac castle tyler bobcat sunny stones asian freddie",
  "chuck butt loveyou norton hellfire hotsex indiana short panzer lonewolf trumpet colors",
  "blaster fireball logan precious aaron elaine jungle atlanta gold corona curtis nikki",
  "polaris timber theone baller chipper orlando island skyline dragons dogs benson licker",
  "goldie engineer kong pencil basketba open hornet world linda barbie chan farmer valentin",
  "wetpussy indians larry redman foobar travel morpheus bernie target hotstuff photos laura",
  "savage holly fuckinside dollar turbo design newton hottie moon blondes lestat avatar",
  "future goforit random abgrtyu jjjjjj cancer qiwe smiley goldberg express virgin zipper",
  "wrinkle stone andy babylon dong powers consumer dudley serenity samurai bigboobs skeeter",
  "lindsay joejoe aaaaa chocolat christia birthday stephani tang alfred ball maria sexual",
  "maxima sampson buckeye highland kristin seminole reaper bassman nugget lucifer airforce",
  "nasty watson warlock philip always dodge chrissy burger bird snatch missy pink gang",
  "maddie holmes huskers piglet photo joanne hamilton dodger paladin christy chubby",
  "buckeyes hamlet abcdefgh bigfoot sunday manson goldfish garden deftones icecream blondie",
  "spartan julie harold charger brandi stormy sherry pleasure juventus rodney galaxy",
  "holland escort zxcvb planet jerome wesley blues song peace nccitoie cavalier gambit",
  "karen sidney ripper oicu jamie sister marie martha nylons aardvark nadine minnie whiskey",
  "bing plastic anal chang savannah loser racecar insane mememe hansolo chiefs fredfred",
  "freak frog salmon concrete yvonne zxcv shamrock atlantis warren wordpass julian mariah",
  "rommel harris predator sylvia massive cats mister stud marathon rubber ding trunks",
  "desire montreal justme faster kathleen irish bertha alpine sammie diamonds tristan",
  "swinger shan stallion pitbull roberto ready april palmer ming audrey chong clitoris wang",
  "shirley fuckers jackoff bluesky sundance renegade hollywoo bernard wolfman soldier",
  "picture pierre ling goddess manager nikita sweety titans hang fang ficken niners bottom",
  "bubble ibanez webster sweetpea stocking tornado lindsey content bruce buck aragorn",
  "griffin chen campbell trojan christop newman wayne tina rockstar father geronimo pascal",
  "crimson brooks hector penny anna google camera chandler fatcat lovelove cody cunts",
  "waters stimpy finger cindy wheels latin robin greenday creampie brendan hiphop willy",
  "snapper funtime duck trombone adult cotton cookies kaiser mulder westham latino jeep",
  "ravens aurora drizzt madness energy kinky sophia stefan slick rocker freeman french",
  "mongoose speed dddddd hong henry hungry yang catdog cheng ghost gogogo randy tottenha",
  "curious butterfl mission january singer sherman shark techno lancer lalala autumn chichi",
  "orion trixie clifford delta bobbob bomber holden kang kiss spunky liquid mary beagle",
  "granny network kkkkkk millie biggie beetle teacher susan toronto anakin genius dream",
  "cocks dang bush karate snakes bangkok callie pacific daytona kelsey infantry skywalke",
  "foster felix sailing raistlin vanhalen huang herbert jacob blackie tarzan strider",
  "sherlock lang gong sang dietcoke ultimate tree shai sprite ting artist chai chao devil",
  "python ninja misty ytrewq sweetie superfly tian jing dian drpepper potter chou darren",
  "hobbit violet yong shen phillip maurice gloria nolimit mylove biscuit yahoo shasta",
  "sexame smoker smile pebbles pics philly tong tintin lesbians marlin cactus tttttt chun",
  "danni emerald showme pirates lian dogg colleen xiao xian tazman tanker patton toshiba",
  "richie alberto gotcha graham dillon rang emily keng jazz bigguy yuan woman tomtom marion",
  "greg chaos fossil flight racerx tuan creamy boss bobo musicman warcraft window blade",
  "shuang sheila shun lick jian microsoft rong allen feng getsome sally quality kennedy",
  "morrison beng wwwwww yoyoyo zhang seng teddy joanna andreas harder luke qazxsw qian cong",
  "chuan deng nang boeing keeper western isabelle subaru sheng thuglife teng jiong miao",
  "martina mang maniac pussie tracey aibc clayton zhou zhuang xing stonecol snow spyder",
  "liang jiang memphis regina ceng logitech chuang dark million blow sesame shao poison",
  "titty terry kuan kuai kyle mian guan hamster guai ferret florence geng duan pang maiden",
  "quan velvet nong neng nookie buttons bian bingo biao zhong zeng xiong zhun ying zong",
  "xuan zang suan shei shui sharks shang shua small peng pian piao liao meng miami reng",
  "guang cang change ruan diao luan lucas qing chui chuo cuan nuan ning heng huan kansas",
  "muscle monroe weng whitney passwor bluemoon zhui zhua xiang zheng zhen zhei zhao zhan",
  "yomama zhai zhuo zuan tarheel shou shuo tiao lady leonard leng kuang jiao basket qiao",
  "qiong qiang chuai nian niao niang huai bianca zhuan zhuai shuan shuai stardust jumper",
  "margaret archie charlott forget qwertz bones history milton waterloo stuff office oldman",
  "preston trains murray vertigo swallow smiles standard alexandr parrot luther user",
  "nicolas surfing pioneer pete masters asdasd auburn hannibal frontier panama lucy buffy",
  "brianna vette shemale baggins groovy global turner blades spanking life byteme lobster",
  "collins dawg hilton japanese polo markus coco deedee mikey strip jersey capital sasha",
  "sadie putter vader lester marcel banshee grendel gilbert dicks dead hidden iloveu sound",
  "ledzep michel female bugger buffett bryan hell kristina molson wookie sprint thanks",
  "jericho grace fuckin mandy trebor deepthroat bonehead mirage models stuart showtime",
  "squirrel pentium mario anime gator powder twister connect neptune bruno butts engine",
  "eatshit mustangs shogun septembe pooh jimbo roger annie bacon center russian sabine",
  "damien mollie voyeur leonardo camel chair germany giant qqqq nudist bone sleepy tequila",
  "megan fighter garrett dominic obiwan makaveli vacation walnut ladybug cantona ccbill",
  "satan columbia napoleon dusty kissme motorola zzzz skater smut play robinson valley",
  "coolio dagger boner bull horndog blake penguins rescue griffey jayeeuz californ champs",
  "qwertyuiop portland queen colt boat xxxxxxx xanadu tacoma mason carpet gggggg safety",
  "palace italia stevie picturs picasso thongs tempest ricardo roberts hairy foxtrot gary",
  "nimrod hotboy asdfghjkl goose overlord blood wood stranger shaolin sooners socrates",
  "spiderman peanuts maxine rogers filthy donnie ohyeah africa national kenny keith monique",
  "intrepid jasmin pickles assass fright potato darwin hhhhhh kingdom weezer throat romeo",
  "gerard looker puppy butch monika suzanne sweets temple laurie josh megadeth analsex",
  "nymets ddddddd bigballs support stick today down oakland oooooo qweasd chucky bridge",
  "carrot chargers discover dookie",
].join(" ");

let commonWords: ReadonlySet<string> | undefined;

// Built on first use, so the list costs nothing until the meter runs.
const isCommonWord = (word: string): boolean => {
  commonWords ??= new Set(COMMON_WORDS.split(" "));
  return commonWords.has(word);
};

const RUNS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "abcdefghijklmnopqrstuvwxyz"];
const REVERSED_RUNS = RUNS.map((run) => [...run].reverse().join(""));

const isRun = (text: string): boolean =>
  text.length >= 4 && [...RUNS, ...REVERSED_RUNS].some((run) => run.includes(text));

const LEET: Readonly<Record<string, string>> = {
  $: "s",
  "0": "o",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
};

// Digits and symbols at the edges are padding ("password1") or letters in
// disguise ("1etmein"), and "1" stands for both "i" and "l", so every
// reading is tried.
const EDGES = [/^[^a-z@$]+|[^a-z]+$/g, /^[^a-z@$013457]+|[^a-z]+$/g];

const readings = (lower: string): string[] =>
  EDGES.flatMap((edges) =>
    (["i", "l"] as const).map((one) =>
      lower
        .replace(edges, "")
        .replace(/[013457@$]/g, (char) => (char === "1" ? one : (LEET[char] ?? char)))
        .replace(/[^a-z]/g, ""),
    ),
  );

/**
 * True when the value is one an offline guesser would try early: a common
 * password in disguise, a repeated chunk, or a keyboard or alphabet run.
 * Callers bound the length first; the repeat test is quadratic in it.
 */
export const isGuessable = (value: string): boolean => {
  const lower = value.toLowerCase();
  if (/^(.+?)\1+$/s.test(lower) || isRun(lower)) return true;
  return readings(lower).some((word) => word.length >= 4 && (isCommonWord(word) || isRun(word)));
};
