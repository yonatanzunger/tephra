# General Ideas

I think by writing. If I have an idea I want to ponder on, I generally want to just sit down and
start writing without thinking too much about where I have to write. This writing normally is a lot
of text, with some occasional scribbles, diagrams, or annotations, and plenty of equations often
within them. If I had an app that helped me organize these thoughts and manage them clearly, it
would simplify my life a lot.

## Some Requirements

1. I need to be able to access this from both my desktop (Mac) and my phone (Android). Most serious
   work would happen on the Mac, but if I'm travelling around I usually only have my phone handy.
   This is one of the reasons (along with searchability) that a physical notebook no longer works
   reliably for me -- I don't have the notebook, or a place where I can sit and write in it, a lot
   of the time.
2. I need to be able to write whether or not I have reliable network. The usual case is "I have an
   idea and need to do some work on one device or the other, reading my existing notes and adding
   more to them." When I get back into network range, having to pause and sync from that device
   before I can continue is generally not a problem.
3. The writing and reading experiences need to be joyful. This means clear fonts, smooth UX, and so
   on. (When I was using paper for this, paper and pen choices were important because I discovered
   that physical resistance of the wrong sort while writing caused me to think less effectively
   because of the friction! On a computer, I'm building custom mechanical keyboards. The full
   physical experience matters a lot and I'm going to want to tune it extensively.)

A note on writing experience: My primary text editing method for the past 40 years has been vim, and
on a desktop machine I'm fastest and most effective for systems that can mimic that behavior. (This
file is being written in VSCode, but with plugins to mimic vim behavior; when it deviates from vim,
it tends to annoy me.)

## The things I need to write and capture

From looking at my history, this "notebook" really contains a number of components to it.

### The main notebook

The main body of the notebook is basically a stream of thoughts -- additions made in a continuous
stream, sometimes adding a single sentence, sometimes writing 20 pages at a sitting. Here the most
core need is for pure text, with tables and equations -- so e.g. .md with TeX and table extensions
is a good start.

Some actions I've always been annoyed when I couldn't take (eg in physical notebooks or in Docs)
have been:

- Bookmark a particular passage, either temporarily or long-term, and be able to find it quickly.
- See the date at which various things happened, if I forgot to manually date-stamp a page.
- Search for something!
- Select some range of this and print it out

### Tagging and branching

There are two related gestures that I find myself needing to do quite a bit, "tagging" and
"branching."

Tagging means that what I really need is several different notebooks for different subjects, but the
overhead of maintaining N notebooks has never once proven worth it for me -- with either physical or
digital ones. But often after writing a passage I realize "oh this is tied to project X." So what I
really want to do is to be able to grab a range and tag it with a project ID, and then switch over
to a view of just things tagged with that ID.

Branching means that I wrote something in the notebook and then realize afterwards that it needs to
live in a file of its own -- maybe because I'm going to share it with someone else, or use it as an
input for something, or just organizationally for my own sanity. So I end up creating a file,
copy-pasting it, and putting a link in from the main notebook where it originally went. This is
great but is an organizational mess if I can't find that branched document.

### The TODO list

A separate thing I need to maintain is my TODO list. This consists of a sequence of entries. In
general, the attributes of a task are:

- A few short words indicating what needs to be done (always)
- Links to relevant docs or additional info (email addresses, etc) tied to the item (sometimes)
- A due date by which the thing has to be done (sometimes)
- Grouping(s) to which this item belongs (variable and dynamic sets, not generally related to the
  groupings of text described under "tagged") (sometimes)
- The status of the task: not started, in progress, done, or "nevermind." (always)

What I generally need to view at any moment is the list of active tasks, with ones that have
impending due dates highlighted; the UX is to add things, change status, change any of those items.

### Miscellaneous other lists and pinned items

Sometimes something that I'm writing within the lab notebook is important to pin for future
reference; these are basically bookmarks that I'd add to it.

Sometimes I end up creating an artifact that needs its own editing. Think of these as a kind of
branching -- a file that has a list, e.g. "blog post ideas," that I'll keep coming back to and
editing over time. In my top-level view of the notebook, I'd like easy access to all of these
list-like things, and be able to pop any one of them up quickly.

### The calendar

I also have to manage my calendar and schedule. Mostly this is done using Google Calendar or similar
apps, and I don't need a replacement for that. But it's really useful for me to keep a list of
upcoming "major events," e.g. talks I'm giving or trips I'm going on. These tend to have a date
and/or time (the range is from "one-hour talk at this hour" to "two-week trip between these dates"),
a location, a quick summary of what it is, a contact person when I need to discuss details about it,
and sometimes a link to some notes about it. This "events calendar" is one of those other lists that
I would always keep pinned.

### Document collections

Finally, there's research and collecting piles of documents. Sometimes I'm reading up on something
and collecting items; these items are a combination of URLs and actual documents (PDF, docx, etc)
that I need to keep track of. Each "bundle" of these would optimally live in a single directory,
with a master file that contains for each:

- A short title
- The URL and/or link to the doc
- A more detailed summary -- autogenerated by default, but human-editable with my notes

It's important to be able to browse this, open the files individually or en masse, edit it, and very
easily add to it. It's also important to be able to "snapshot" a URL -- click a button and download
the full URL, putting that in as a document in the folder, and linking to it.

I'd want at some point to have a Chrome extension that lets me quickly add any web page I'm viewing
to one of these filesets.

Filesets would be referenced from the lab notebook, might be pinned like other files, and so on.

## Early structural thoughts

Patterns that are emerging for me:

- The overall notebook "on the wire" probably looks like a directory hierarchy. The raw lab
  notebooks (and figures etc directly included therein) lives in one folder, maybe with files named
  YYYYMMDD.md for the main body. Branched files maybe live in that directory or others.
- Bookmarks sit inline within the .md files, but we have a "master index" file of bookmarked things
  so that we can quickly load that in the UI and jump to items.
- Filesets live in some structured file type (YAML?) plus directories for the data.

## Things tried and rejected

Standard notebook apps: The UX isn't *mine* and I'm stuck following other people's leads. And it
never follows the exact structures above. Basically, I want something highly personalized to the way
*I* work.

A physical notebook: Works great except that it isn't always available, it isn't searchable, and
motions like branching are impossible. Which is to say, it worked great for me 20 years ago.

## Mobile versus desktop

While "serious" work happens on desktop, sometimes I've only got my phone. I definitely need the
ability to read, search, and write from the phone; really, it's hard to think of functionalities
that I wouldn't want. The huge advantage of the desktop is screen real estate and a better input
device, which makes it much more preferable to work on, but "the best camera is the one you have
with you" applies here too.

## What UX failure looks like

A few examples, not at all comprehensive:

- Any sense that I'm going to lose state if I don't manage it carefully -- scroll position,
  something I type is lost, etc. I always want that certainty that I can get right back to where I
  was.
- Ease of reading: Choice of font, color, etc., to maximize legibility. Bad fonts or font rendering
  can be a killer.
- Repsonsiveness of writing: Typing latency would be a huge issue. I type about 130WPM on a keyboard
  and it would be very unpleasant if it couldn't keep pace with me.

There are probably many other things and it's going to take some real experimentation to find what
they are.