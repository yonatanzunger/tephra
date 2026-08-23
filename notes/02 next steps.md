# Next Steps

The implementation cycle has raised a few issues that require design thinking.

## Comment, Import, and Annotate

While looking at the UX, the value of comments in the margin became extremely clear. This lead to
two realizations about flows that I'm likely to use very heavily if they become available.

### Commenting

The MD format doesn't have a concept of "attaching a comment at a location," but this is something
I've observed in numerous other projects is an important gap. We should define a standardizable
extension to MD -- in much the way that KaTeX and tables are extensions to the core MD format --
that encodes the concept of a comment inside an MD file.

On the wire, a comment thread would be something that can be inserted anywhere in the flow of text.
A comment thread includes:

- Required: A bool "resolved" state (we often only show unresolved threads)
- Optional: The ID of a user to whom this thread is "assigned"
- Required: An array of comments, each including:
  - Required: Contents (MD; we probably don't need comments to nest within comments, so we can
    exclude that)
  - Optional: The name of the commenter and the timestamp at which it happened. (This is important in
    multi-user applications; not so much for tephra but this comes up a lot elsewhere)
  - Optional: Emoji responses by other commenters (pairs of [emoji, user ID*])

These can be rendered in many different ways, depending on the situation. Tephra illustrates two of
them:

- On all platforms: At the point in the text where a comment thread exists, we place a visible
  marker, e.g. a number in a darkened circle.
- On desktop: There is a right-hand rail in which the comment threads are rendered. Individual
  threads can be collapsed. Printing can either include or exclude comments.
- On mobile: When a comment is "collapsed," it is not shown except for the marker. When it is
  "expanded" (e.g. by clicking on the marker, or an "expand all" action) then the comment thread is
  shown as an inset box with special shading and fonts below the affected paragraph.

### Import and Annotate

One flow this immediately implies is "import and annotate:"

- Bring in a file from the outside world -- maybe md, docx, html, or pdf. Add it to the repository,
  usually linking it from the text flow "today."
  - For files like .md and .docx, we would import it, translating it into Tephra's native format
    (md) as the default action.
  - For files like .html and .pdf, we need to think about how to handle this. arXiv papers will be
    the classic case of this, and often include extensive figures.
- View that file in Tephra's native viewer (md) or something else TBD. Read over it and add comments
  as we go. Store the file with its comments within the Tephra notebook.

This flow would happen overwhelmingly on desktop. There, we have an even further-right rail that
lets the user directly write into the main notebook log, which is a very common thing to do at the
same time as this.

I do this a lot with everything from arXiv papers to transcripts of court arguments, and being able
to do it and store it in the notebook would be an amazing upgrade to today's process -- which often
involves printing a hardcopy, annotating it, then writing up notes in the main notebook, and often
losing the annotated hardcopy in my giant piles of paper.

## The Difficulty of Purging

The purge procedure outlined in this protocol is, in profound ways, Not Great. We need to do a
serious threat analysis around writing politically sensitive materials while living in a situation
where threat actors could easily compel GitHub to reveal data. The simplest solution is the old
Soviet one -- don't think; if you think, don't speak; if you speak, don't write; if you write, don't
sign; and if you sign, don't be surprised. But I'd really like to be able to write truly
*privately*, in a way that wasn't easily subject to seizure.