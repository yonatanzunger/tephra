# Further thoughts about dockets after milestone 1

Seeing the first milestone is already making me realize some useful things about this.

## This isn't just for recurring tasks: this is excellent backlog management

The stuff in the "house" list is already including a list of repair projects, broken into sections
by the rough scale of work... which is really useful and exactly the way to think of a backlog.
These aren't recurring; they're pulled off the list *once* and then go into action.

Looking at it, this implies some interesting common verbs and nouns if we reorient a bit.

Matters can either have no schedule (backlogged tasks), fixed schedules (upcoming events), or
periodic schedules (recurring events). For items with fixed or periodic schedules, tasks and horizon
statuses (let's just refer to these as "tasks") are specified at intervals before or after the
critical date (the next occurrence). Items with no schedule are "inactive" in the sense that they
will never trigger those events on their own; when those items become active, they essentially move
from "on the backlog" to "in progress," and now they generate the same tasks and so on, but they do
so at time intervals relative to *the moment that they were activated,* always obviously at positive
intervals relative to that, and so they effectively become fixed-schedule items.

So the term "run-up" is a bit misleading. We can instead talk about the "tasks" (which really means
both TOOD items and horizon statuses) associated with a work item. There are three basic types of
these and two major ways their schedule can be described:

1. **A task to complete:** i.e., when these are scheduled they turn into TODO items.
2. **A status to be aware of:** i.e., when these are scheduled they go onto the horizon.
3. **The next instance of this matter:** i.e., this is the implementation of "every N days, measured
   since last completion."

And their schedules can take two forms:

1. **T±N days:** Dates relative to the "critical date" for the matter. That's the fixed schedule
   date, or for a periodic matter, the specific date of that instance.
2. **{item}(+N days):** This item gets scheduled either as soon as another item is completed, or a
   fixed time after that item is completed.

Note that this really separates out the two kinds of recurring matters: the ones that happen on a
fixed schedule (e.g. birthdays) and the ones that happen at intervals after completion.

So in this updated world, we might create:

1. **A backlog task:** e.g., a repair we have to do. Its tasks would be the list of things that have
   to happen, which are often daisy-chained: e.g., for a car repair matter, the tasks might be:
   1. *Find a suitable shop:* TODO item, scheduled at T=0 (this is the default schedule; it means that
      as soon as this matter is activated, that goes on our TODO list).
   2. *Have the car fixed:* TODO item, scheduled at `{item 1}` -- i.e., as soon as #1 is marked
      complete, this is added to the TODO list.
   This task would render in the UI with its title, the list of tasks expandable underneath it, and
   for the "date" column it would just have an "activate" button -- i.e., it has no critical date,
   but pushing that button would set its critical date to "today" so it now becomes active.
2. **A scheduled event or active task:** e.g., a talk to be given. This works much like the previous
   one, but it has a scheduled date from its inception. Its tasks may look like:
   1. *Prepare the talk:* TODO item, scheduled at T-14 days.
   2. *The talk:* Horizon item, scheduled at T=0, with an info field that includes the address and
      time.
3. **A truly periodic event:** e.g., a birthday. This works the same as a scheduled event, but its
   target date is "YYYY-11-15", i.e. every year on a given date. Under the hood it has an infinite
   sequence of instances, and some time before one instance we start scheduling its events. The
   docket UI would show both its next occurrence and its periodicity, which it gets directly from the
   configuration of that matter.
4. **An interval-scheduled event:** e.g., changing air filters. The task list looks like:
   1. *Change air filter:* TODO item, scheduled at T=0 days.
   2. *Next instance:* Reschedule, scheduled at {item 1} + 90 days.
   In the UI, these would show up like regular tasks, but when we showed the "scheduled date" in the
   top level of the UI, we'd show its next occurrence and its periodicity, as for a truly periodic
   event, but now periodicity is inferred from the task list. If there is exactly one "reschedule"
   task on the list, we can infer from that and say "every 90 days" in the UI; if there are multiple
   such events, or it's otherwise hard to infer exactly what the periodicity is, we could just say
   "see task list" in the UI.

## What this means for the horizon view

For the four types of item above, we can calculate instances within a certain time range:

* For backlog tasks, there are no instances in the time range.
* For scheduled events or active tasks, all the generated horizon items within the time range. Note
  that (as for all event types), we only include horizon items that have no pending "after <item>"
  clauses; those are only added to the horizon after their preconditions are satisfied.
* For truly periodic events, all generated horizon items within the time range for all occurrences.
  To calculate this meaningfully, note that we can go over all the tasks for this item, considering
  only those who are scheduled at T±N days, and find their offset relative to the scheduled event
  time. Then for each of those items, the actual scheduled event time is an infinite arithmetic
  sequence (initial time) + k * (periodicity), and so we can trivially compute the set of items that
  fall within the requested time window. Note that we should annotate each status item with which
  instance it's associated with to avoid confusion! (It's very possible for tasks from two different
  recurrences to occur in the same time window)
* For interval-scheduled events, that same "we aren't handling things whose date depends on other
  items" rule means we only do this calculation for the next occurrence.