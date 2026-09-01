# The TODO feature

Having started to use Tephra some more, I'm getting a bit more clarity about what a useful TODO
feature would look like, and it's a bit different from the previous versions.

## Past experiences and their successes and failures

### Era 1: The Paper-Based Era

The experience that I'm trying to capture is similar to that of the paper-based era, where I would
use a two-page spread, and each TODO item would receive a single line. At the left was a column of
statuses; this being done on dotted-grid paper, a bare dot from the underlying paper indicated
something not yet started, a slash indicated a task in progress, and an X indicated completion. If a
task was cancelled outright, I would strikeout the entire line. If a task had an urgent due date,
"DUE 5/4" would be written in larger letters as part of the row of text.

This worked surprisingly well for a few reasons:

1. My eye got quite good at ignoring X'ed rows and jumping only to the dot and slashed ones, so I
   could easily see which items were still live.
2. There was a maximum of a single two-page spread at a time, and the move from one page to the next
   forced discipline about flushing items that were clearly stale and never going to happen. (During
   this point, any uncompleted items' status would be updated to either >, to indicate "migrated to
   next list," or strikeout)
3. The number of tasks with a due date was surprisingly small, so this remained fairly manageable.

Its failure modes were fairly limited:

1. There was no good way to attach links to items -- e.g., "this is the doc I'm working on," "this
   is the doc that needs to be reviewed," etc.
2. Portability was limited to wherever I had the notebook handy, which became a problem down the
   road as my work rhythm changered.
3. There was no way to represent "I am working on this complex project that has its own set of
   milestones etc.," which meant there was no way to see either the list of projects or their
   status, only scattered TODO items.

The first two failure modes are instantly solved by putting this on a hybrid desktop/mobile app like
Tephra. The third requires some new features.

### Era 2: The Doc-Based Era

I've had a semi-computerized version of this living in text files in a more recent era. This solved
problem 1; not problem 2 because I was forced to use M365, which doesn't really work on mobile; and
created some useful approaches to problem 3 in that I would use nested list structure to group items
by subject.

In this era, I discovered that another useful status to add was "BLOCKED awaiting <something>." This
was aided by the way in which I tried to transfer the second useful property: in each day's
notebook, I would create the TODO list as a nested bulleted list, and I would start each day by
copying over the previous day's list, removing items that were done or no longer of interest, and
working from there. Having a status that was too long to fit into a single row was no longer a
problem, as well as a status that would change back and forth several times during the life of a
task, which was harder to do in the paper version.

The best features of this era were:

1. The daily copy and trim achieved the same value as the page migration of the first era, including
   keeping the active TODO list relatively short.
2. It was easy to maintain additional relevant information for each task, more specifically links
   that were involved in it (docs to review, docs being written), due dates, and what progress was
   blocked on, if anything.
3. Nested list structures let me reorganize each day's TODO list in the way that was most useful for
   that day. Typically I'd have one section for "urgent" tasks -- things that absolutely had to
   happen *today* -- and then other things would be broken up by subject.

The problems in this era were:

1. Portability was limited because I was forced to use M365, which doesn't really work on mobile.
2. The "urgency" tagging conflicted with the subject-grouping tagging, and that made it hard to scan
   things in two ways at once, which would often have been useful.
3. The TODO list tended to grow quite a bit more than it did in the previous era -- although I'm not
   sure whether that was circumstantial or because of the shape of the tool. (Writing something in
   my paper log felt like more of a commitment, whereas "yes I should do this" got added much more
   to the era 2 list)

## Desiderata

Looking at the lessons of these two eras, a few things emerge.

1. Having this in a combination desktop/mobile app like Tephra would solve both the portability and
   supplementary data problems, so that's great.
2. TODO items often contain links to various things. They may also contain due dates.
3. I really want to be able to tag TODO items with N>0 tags; the set of active tags varies over the
   timescale of a week or so. Then it should be easy to see things grouped by tag, and also a
   section of "things due in the immediate future."
4. I do want to preserve the history and order in which things were added to the TODO list.
   Scrolling back to see the TODO list from 3 days ago and finding a link in it that I need is a
   very common motion. (Really: what would have been awesome is a directory of links that showed up
   in my TODO list, together with notes about what they were from and links to the underlying TODO
   items, sorted reverse-chronologically by last appearance of the link and easily searchable.)
5. I need some kind of mechanism that forces me to start each day by grooming the TODO list; seeing
   what's still active on it and cancelling items that are no longer interesting.
6. It would be good to have some "backlog" status as well, moving an item from the active TODO list
   to "someday, I suppose," without actually cancelling it.