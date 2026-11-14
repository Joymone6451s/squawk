"""The demo's narration, in plain words. Each line says what is spoken, what the caption shows and what is on screen."""

# (shot, picture, words spoken, caption or None, emotion, cfg_weight, pause after)
#
# The voice model reads "NEAR" letter by letter and stumbles on "near.social", so the spoken
# words say "Near" and "Near Social". The captions carry the real spelling. Spoken "writer"
# came out sounding like "rider", so the narration says "author" instead.
LINES = [
    ("hook", "hook", "Meet Polly. A parrot on Near that nobody owns.", "Meet Polly. A parrot on NEAR that nobody owns.", 0.85, 0.35, 0.4),
    ("hook", "hook", "She has her own account on Near Social, and it has no keys. Nobody can post for her. Not even us.", "She has her own account on near.social, and it has no keys. Nobody can post for her. Not even us.", 0.8, 0.3, 0.45),
    ("hook", "hook", "So how does she decide what to say? You feed her!", None, 1.0, 0.3, 0.7),

    ("bake", "bake", "First, bake some crackers. Crackers are her coin, and the price never changes.", None, 0.8, 0.35, 0.6),

    ("feed", "feedpick", "Now pick a post you like, and feed it.", None, 0.85, 0.35, 0.35),
    ("feed", "feeddialog", "The crackers get eaten. But most of the Near inside them goes straight to the author, right away.", "The crackers get eaten. But most of the NEAR inside them goes straight to the author, right away.", 0.9, 0.3, 0.4),
    ("feed", "feeddone", "So feeding Polly means tipping the person who wrote the post.", None, 0.9, 0.35, 0.6),

    ("example", "cardexample", "Feed one hundred crackers, and the author gets three quarters of the Near inside. Polly keeps the rest for her upkeep.", "Feed 100 crackers, and the author gets three quarters of the NEAR inside. Polly keeps the rest for her upkeep.", 0.8, 0.35, 0.7),

    ("pile", "pile", "Every post gets a pile, and the whole flock has to reach the round's target together.", None, 0.85, 0.3, 0.4),
    ("pile", "pilefull", "So feed early, because early crackers count for more.", None, 0.9, 0.35, 0.7),

    ("squawk", "countdown", "In this demo, each round lasts five minutes. The real coin runs one round a day.", None, 0.8, 0.35, 0.35),
    ("squawk", "asleep", "When the round ends, Polly falls asleep, with the winning post on her mind.", None, 0.8, 0.3, 0.4),
    ("squawk", "wakeclick", "Anyone can wake her up. And whoever does gets paid for it.", None, 0.9, 0.35, 0.5),
    ("squawk", "squawking", "Squawk! She shares the winning post on Near Social, all by herself.", "Squawk! She shares the winning post on near.social, all by herself.", 1.15, 0.3, 0.7),

    ("said", "said", "Look closely. This post was written by a smart contract. No person, no server, no password.", None, 0.85, 0.3, 0.4),
    ("said", "said", "She quotes the winner and follows the author, so the whole flock can find them.", None, 0.85, 0.35, 0.7),

    ("streak", "streak", "Keep her fed every round, and the streak grows.", None, 0.9, 0.35, 0.3),
    ("streak", "streak", "The longer the streak, the smaller her cut, and the more the authors earn.", None, 0.9, 0.3, 0.7),

    ("books", "books", "You never have to trust us. Every cracker and every payment is on the chain.", None, 0.75, 0.35, 0.35),
    ("books", "keys", "No owner. No keys. See for yourself.", None, 0.85, 0.35, 0.7),

    ("why", "cardwhy", "Authors get paid for good posts.", None, 0.85, 0.35, 0.3),
    ("why", "cardwhy", "Fans decide what gets heard.", None, 0.9, 0.35, 0.3),
    ("why", "cardwhy", "And the early bird earns a little Near, just for waking her up.", "And the early bird earns a little NEAR, just for waking her up.", 1.0, 0.3, 0.7),

    ("tool", "cardtool", "And her voice is a free tool now. Any app on Near can speak on Near Social, with no keys at all.", "And her voice is a free tool now. Any app on NEAR can speak on near.social, with no keys at all.", 0.9, 0.35, 0.8),

    ("end", "end", "This is Polly, the parrot nobody owns.", None, 0.9, 0.3, 0.4),
    ("end", "end", "Go on, give her a cracker!", None, 1.2, 0.3, 0.3),
]

SHOT_ORDER = ["hook", "bake", "feed", "example", "pile", "squawk", "said", "streak", "books", "why", "tool", "end"]

# The small label at the top of the screen during each part.
LABELS = {
    "bake": "1. Bake crackers",
    "feed": "2. Feed a post",
    "pile": "The flock's target",
    "squawk": "3. Polly squawks",
    "said": "Written by the contract",
    "streak": "The streak",
    "books": "Check it yourself",
}
