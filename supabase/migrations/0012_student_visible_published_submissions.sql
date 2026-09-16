/* Bug fix: students and guardians never saw any grades, even published ones.

   assessment_marks' own SELECT policy (marks_sel) correctly lets a student
   see their published marks — it checks structure_status(structure_id) via
   a SECURITY DEFINER function, which bypasses RLS internally, so that part
   was always fine.

   But the client also reads mark_submissions directly (hydrateGroup("academics")
   does a plain `select * from mark_submissions`) to know WHICH structures are
   published, so the UI can decide what to render. The original subs_sel
   policy only allowed admins and the assignment's own teacher to select from
   mark_submissions at all:

     using (public.is_admin() or public.teacher_can_write_structure(structure_id))

   For a student or guardian, every row was denied — not just unpublished
   ones — so the query came back with zero rows regardless of status. With no
   submission record to point to, the client had no way to tell a published
   structure apart from a draft one, so it rendered as if nothing was ever
   published: grades looked completely missing, even though the marks
   themselves were sitting right there in assessment_marks.

   Fix: also allow reading a mark_submissions row once its status is
   'published'. This only exposes the same "published" flag that already
   governs (and was always meant to govern) whether a student can see marks
   for that structure — never submitted/approved/draft/returned rows, and
   never the marks/scores themselves, which stay governed by marks_sel. */

drop policy if exists subs_sel on public.mark_submissions;
create policy subs_sel on public.mark_submissions for select to authenticated
  using (
    public.is_admin()
    or public.teacher_can_write_structure(structure_id)
    or status = 'published'
  );
