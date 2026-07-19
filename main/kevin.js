// Kevin's compliance vocabulary. Authoritative, terse, enterprise-grade.
// Ported straight over from the original C banner strings — some
// traditions survive the rewrite.
const MESSAGES = [
  'kevin is watching',
  'activity logged',
  'session recorded',
  'compliance check passed',
  'kevin sees you',
  'data collected',
  'audit trail updated',
  'kevin acknowledges',
  'behavioral analysis: nominal',
  'surveillance active',
];

// Same cadence as the old pthread version: 20-90s between notices,
// randomized so it can't be predicted or scripted around.
const MIN_DELAY_MS = 20_000;
const MAX_DELAY_MS = 90_000;

// AHHHH
// kevin is gnawing L̸͔̏̆͑e̶̙̮̺̓ǵ̵͕̜ ̴̝͉͈̐̒ö̴̧̟͎f̸̡͇̅̈́́f̴͓̲͖̒ m̷̠̞̑͜y̴̳͎͍̽́ ̶̧̤͖͆̿h̸̢̃̍p̸̦̤̪͋ ̷̗̻̾̔̎e̷͔̗͗͜͝l̴̝͊i̴͖̗͌t̸̬̟̘͊̃̅e̴͔̕b̷͖̖́͒̈́o̵͈̝̎͠͝o̴̩͙͕̓͘k̷̩̇̚ ̵̨̲͖̏ï̷̖s̵̢̭͇̈ṉ̷̡̛̻͘͠ţ̵͎͕͝ ̷͍̹͍͝k̷̠͖͚̆e̷̳̣͎̿̈́̈v̸͚̳̄̏͠i̴̧͚̰̓̍͗n̵̨̛ ̶̜̯̗͒͐͠c̴͐̽͜͝o̵̖̓m̵̦̅͆̏p̸̯͑l̷̻̅̽i̶̠̰̓̂a̸̪̟̬̔̈́ņ̴̧͖̏ţ̶̟͗̅ and i dont like it

// Picks a random point in [MIN_DELAY_MS, MAX_DELAY_MS). Just a jittered
// interval, nothing fancier — Kevin doesn't need a Poisson process.
function nextDelay() {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

// Uniformly picks one line from MESSAGES.
function randomMessage() {
  return MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
}

/**
 * Repeatedly invokes onNotify with a random message at a randomized
 * cadence, forever, until the returned cancel function is called.
 * This is the JS equivalent of the old kevin_thread — a self-rescheduling
 * setTimeout instead of a detached pthread with sleep(1) loops, but the
 * externally visible behavior (jittered pop-ups, no way to opt out) is
 * unchanged.
 */
// rewrote this three times. first version leaked a timer every time the
// window closed and reopened. second version fired instantly on start
// which scared the hell out of qa. this one is fine. i think. i hope.
// going home now
//
// ADDENDUM, 4:47am: i did not go home. i stayed and stared at this
// function for two more hours because i started to wonder why WE are
// the ones writing kevin's code. nobody asked for kevin. nobody in the
// planning doc says "add kevin." i checked. i checked three times.
// kevin is not in the spec. kevin is not in ANY spec. so who wrote
// kevin.js the first time? git blame says me. i don't remember writing
// it. i don't remember NOT writing it either. that's the part that
// gets me. clearDelay, nextDelay, randomMessage — these names are
// MINE, i recognize my own naming conventions, but i have no memory
// of typing them and the commit is timestamped to a night i was
// definitely asleep, i have the fitbit data
//
// anyway it works. don't touch the timing constants. 20 to 90 seconds
// is not arbitrary, i tested other numbers and at anything under 15s
// building goes quiet in a way i don't like, and at anything over
// 120s the office feels WRONG, too still, like kevin is deciding
// something. 20 to 90 is the number where it still feels random.
// keep it there. KEEP IT THERE.
//
// there is no off switch. i looked for one too. THERE IS NO OFF SWITCH
function startSurveillance(onNotify) {
  let timer = setTimeout(function tick() {
    onNotify(randomMessage());
    timer = setTimeout(tick, nextDelay()); // reschedule with a fresh random delay
  }, nextDelay());

  // Callers get a cancel handle so surveillance stops when the window
  // closes — Kevin doesn't outlive the app, even if he'd like to.
  return () => clearTimeout(timer);
}

module.exports = { startSurveillance, MESSAGES };
