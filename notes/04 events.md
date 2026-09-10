# The Event Feature

There are a few classes of things that tend to require my attention that the TODO feature on its own
doesn't manage, but which would be *immensely* valuable for Tephra to help take care of. I'm using
"events" as a placeholder name for all of these but that's not a good name -- we need something
clearer.

The overall goal of this is that, even when there are events that are happening further in the
future, or periodically, or events that require long enough advance prep that I will totally fail to
think about that in time, **I realize, in a timely way, that there's some important task or event
coming up and work both the requisite prep tasks and the requisite prep thinking into my schedule.**

## First notes

Some examples of the tasks I need to manage are:

* A household task that has to happen every so often (e.g. changing the air filters)
* A task that has to happen after another one is done (e.g., schedule the SA-512 maintenance for the
  car after its normal maintenance is done)
* A periodic event requiring little prep (miscellaneous Jewish holidays) ⇒ These are sort of
  different, there's no TODO for these; it's more of a reminder.
* A periodic event requiring significant prep (my wife's birthday)
* A one-off event requiring nontrivial prep (a conference where I'm giving a talk)

What do I really need to happen with these kinds of events?

* Each of them has a "scale of ramp-up window" -- how far in advance do I need to have this become
  an active thing on my mind? At this point, we start generating TODO tasks.
* If any of them has a window where it becomes due and then urgent, that has to be a feature.
* Each morning's "init" routine (where we do the walkthrough etc) should also include the day's
  reminders. Those reminders should also be visible in the bottom of the sidebar.

This implies one additional UX surface that we haven't mentioned yet: coming / occurring events.
This is really a pair of surfaces:

* The "happening right now / immanently" view (aka the compact horizon view) -- this needs to be
  somewhere quite visible within the normal default view. One option is in the bottom of the
  sidebar; another would be some visually prominent item within the TODO view. The total amount that
  can be shown here is always very limited.
* The deep "horizon" view -- this is a dedicated view that lets you see all the coming events, and
  links naturally to the editing experience for them.

## How we might represent this

So I could have a collection of "event/task" files. Each file specifies various items, and things
like:

* The title of the item
* When it happens.
  * Simple version: A date and optional time.
  * Fancier: This may give a date or time *span*, since some things last multiple days.
  * Periodicity: Is this a one-off, or does it happen on a schedule? Simple schedules are "an
    explicit list of occurrences," "a pointer to an ICS file in the same directory containing a list
    of occurrences,"  and "every N days, counting from the last time it actually happened." Fancier
    things would be "fixed dates by the Gregorian or Jewish calendar" or "the third Thursday of
    November" and those are things we might add later if we need.
* The various actions that this event triggers, such as:
  * If there's an actual *event* tied to this, at what point do we insert a "this is going to happen
    soon" indicator into the compact horizon view?
  * If this generates TODO items either as part of actually doing it or as preparatory work, how far
    in advance are those items generated? What will their text be (and let that text use replacement
    markers like `{date}` that we substitute in with parameters from the actual event occurrence),
    what tags will they get, what due date will they get?
  * If one of these TODO items causes this entire event to be marked as DONE -- and thus affects
    rescheduling of "N days after the last time" -- then indicate that TODO item.
* An optional link to a single relevant doc
* An optional name of a contact person who owns this event

(Those last two fields have been derived from experience)

I'd expect to have multiple of these files, for things like:

* Household tasks (per house)
* Birthdays
* Holidays
* Speaking engagements

All of these would live in a single top-level folder; it's not clear what an "events" file elsewhere
would do. Logically, this folder is a single document, whose viewing happens via the "horizon" view
(see below) and whose editing happens (at least to start with) by editing the underlying files as
YAML and ICS.

Each individual file is therefore a set of events, and the composite set of events is just their
union. For any event, I should have simple functions that from that data immediately compute:

* The complete event list: Basically denormalizing the event occurrences into N individual events,
  so that we can easily display this in the horizon view.
* The complete list of things that are going to happen and when they are going to happen, basically
  a list of "at (time) we will (add a horizon item, remove a horizon item, add a TODO item, etc)

This entire logic should be independently unittestable.

## UX Flows

### The "horizon" view

There is going to be a short list of events that are either happening right now (e.g., "today is a
holiday") or on the imminent horizon. These have short, descriptive names. We should regularly
display these in the bottom section of the sidebar so I'm always aware of them, and be able to go to
a broader "horizon" view that shows all the upcoming events and lets me scroll and explore them.

In the compact sidebar view, I would just want to see "<Event>" or "<Event> tomorrow" or the like.

In the full horizon view, we'd pop open a separate window and view a constructed virtual object
that's built out of the union of all our event files. This would look like a table, by default
sorted by date; the rows would include when it happens, the title, links to requisite data, etc.

### The "reorient" flow

The "walk the list" flow is really a stub; what we really want this to be is a "reorient" flow,
which I invoke whenever I come to the system for the first time in a while or when I'm just
overwhelmed with state and need to distill down to "OK what is important right now?"

This flow can be invoked with either a menu command or a button from the TODO window. In various
circumstances, the app will suggest that I do a reorient, e.g. when a day rollover has happened
(like we use to trigger the walk flow now); that suggestion might take the form of visually
highlighting the "reorient" button or some similar suggestion. But I can reorient whenever I need
to.

The goal of this flow is that, after it completes, I have a clear mental picture of:

* The overall TODO list
* Which items I've decided to do today (or more generally, in my immediate future)
* What significant things are coming up "on the horizon."

Grooming TODO items, especially ones that have been on the list for a while, is a natural one.
Tagging some of them with "today" is another thing. (This tag is in addition to other tags, and we
should always pin the "today" tag to the top of the list)

### Editing events

The simple version of this is going to be editing the events file as YAML. Later on, we'll probably
want a better UI, directly integrated with the horizon view.

## Supporting Evidence -- What Has and Hasn't Worked?

### Household tasks

One huge issue that's been emerging is the rapidly increasing number of tasks generated by managing
multiple physical households. Some of these are routine tasks which I am simply terrible at
remembering -- e.g., periodic maintenance on the house or the car. Others are major projects which
have to happen -- e.g., repair of the garden, refinishing of floors. This isn't just a list of TODOs
that happen at various intervals, but the collection of all related items is itself an artifact that
I need to work on, develop, and maintain jointly with my wife: we sit together looking at this list,
decide which things to prioritize and act on, when to schedule them, who owns what, and so on.

This is probably the "hottest" open item, as we've been trying a range of tools for this over the
years without success. I'm thinking that Tephra gives me one important advantage, because *it's
already a dashboard that I look at daily.* If something shows up on "I need to do this today" then
it's now in my head even if it wasn't before, and the stress of remembering those missing items has
been a major problem.

### Events with a run-up

Three good examples of these are:

* Trips: These get generated almost following a template (I literally do have a doc template for the
  details of a trip) and then generate a bunch of associated TODO items depending on those, like
  taking the dog to the kennel. They also generate calendar items, which should naturally surface on
  my existing (Google) calendar.
* Talks I have to give: In addition to any involved travel, these also involve run-up tasks of
  preparing the talk. Also, it's really important for me to get a reminder that this is upcoming 2
  weeks or so ahead of time; the most important thing is that during that window, I'm aware that a
  talk is approaching and am thinking about it during downtime.
* Events like my wife's birthday: This requires nontrivial planning a few months in advance, and is
  often going to lead to me sitting down and creating a doc just to figure out the plan. I need
  something to remind me of this and then drive the TODOs.

All of these represent major observed missing gaps: anything tied to remembering these, I've had to
remember (and generate the corresponding TODO items for) by hand.

Conversely, holidays really do belong only on the calendar. However, they do usefully appear in the
spreadsheet, below.

### The missing spreadsheet

In era 3, I had a spreadsheet of coming events, which was very useful. Right now I don't really have
that, and I need to resurrect it. The advantage of it being in Tephra is simply that Tephra is
increasingly where I'm spending my time, not Excel. (Something for which I'm quite grateful) Also,
when I was managing that spreadsheet, I had a full-time exec assistant who was also owning and
driving a lot of what was in there; it was a communication channel with someone who helped me plan
and manage things, which is very similar to the use cases noted above.

I really want this view to exist again, and it *would* show holidays as well as trips and talks and
so on all in one place. That's separate from a calendar view, which is focused on "what am I doing
on day X" and is packed with meetings; this is just major events, shown in a list view.