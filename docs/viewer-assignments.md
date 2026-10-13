# Viewer account assignments

Login usernames and names in imported business data are separate. A viewer's
`User.viewerName` identifies the exact dealer/RM name they may access, ignoring
case. Both dealer and RM assignments for that same person count toward their
book, as before. No first-name, prefix, or fuzzy matching is used.

## Deploy and fix the reported account

1. Deploy this version with the normal `npm run build` command. It runs
   `prisma migrate deploy` before building Next.js. The additive migration adds
   nullable `User.viewerName`; Prisma Client is generated during installation.
   Run `npm run db:generate` first when building from an existing installation.
2. Sign in as an admin, open **Targets → User accounts**, and find `thileepan`.
3. In **Assigned dealer/RM**, choose **THILEEPAN V** and click **Save**.
4. Have the viewer refresh the page. Their username and password stay the same.
   Check Clients, Dashboard, MIS, Targets-derived salary, and Monthly Tasks.

The database investigation found 95 dealer assignments and 5 RM assignments
for `THILEEPAN V`. Those counts are separate roles and may overlap; they should
not be added to infer a distinct-client count. Actual counts can change as data
is uploaded. This change does not automatically modify any account assignment.

## Prevent recurrence

- New viewer accounts require a selection from existing dealer/RM names.
  The server validates the selection; free-form unknown assignments are rejected.
- The dropdown includes registries and names present only on master clients,
  and displays dealer and RM client counts.
- Existing users with no explicit assignment retain the old exact username
  match. The admin table flags those with no matching person, and separately
  identifies valid people with no clients yet.
- If a dealer/RM is renamed or removed, review affected user assignments here
  and save the correct name. Invalid assignments show **Account assignment
  needed** rather than a misleading zero-data dashboard. A new upload using an
  old or differently spelled person name must be corrected in the business data.
- Assignment changes are admin-only and recorded as `ASSIGN_VIEWER` audit events.
  Assignment access is resolved from the database on each API request, not from
  a client-supplied field or an old JWT claim. Refresh the browser to replace any
  data already displayed before the change.
- Missing assignments cannot access viewer data APIs, but the user can still
  change their password, view account-assignment help, and sign out.

## Verification

Run `node tests/viewer-assignment.cjs` for assignment, authorization, legacy-user,
and password-change hook-order regressions. Run `npx prisma validate` and
`npx next build` for schema and production compilation checks without deploying
migrations. Deployment itself uses `npm run build` as described above.
