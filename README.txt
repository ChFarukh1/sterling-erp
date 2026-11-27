STERLING ENGINEERING - PAYROLL, HR, ATTENDANCE AND PROCUREMENT - SETUP GUIDE (version 12)

FILES
  index.html, app.js, logic.js, config.js   the system (payroll)
  hr.js                                     HR, live attendance, attendance register, letters, users and access
  proc.js                                   procurement: requests, RFQ, quotations, comparison, approval, POs, deliveries, suppliers
  templates.js                              company documents (offer, warning, experience, termination letters, RFQ, purchase order)
  logo.jpg, favicon.png                     company logo (upload these with the system)
  1_database_setup.sql                      run once in Supabase
  sterling_import.json                      your sites, employees, rates and bank details only.
                                            No salary runs and no advances: everything starts from zero.
                                            KEEP THIS FILE PRIVATE. Never upload it to the website.

TRY IT FIRST (no accounts needed)
  1. Unzip. Double-click index.html. It opens in your browser in demo mode.
  2. Go to "Backup and import" and choose sterling_import.json.
  3. Demo data stays in that browser only.

GO LIVE
  A. Supabase (database and logins)
     1. Create a project at supabase.com (region: Singapore).
     2. SQL Editor > paste all of 1_database_setup.sql > Run.
     3. Authentication > Users > Add user. Create your login and the owner's login.
     4. Authentication > Sign In / Providers > turn OFF "Allow new users to sign up".
     5. SQL Editor > run the two "insert into public.profiles" blocks at the bottom of
        1_database_setup.sql with the real emails (admin = you, owner = view only).
     6. Project Settings > API > copy the Project URL and the "anon public" key.

  B. Connect the system
     7. Open config.js in Notepad. Paste the URL and the anon key between the quotes. Save.
        Never use the "service_role" key.

  C. Cloudflare Pages (hosting)
     8. Cloudflare dashboard > Workers & Pages > Create > Pages > Upload assets.
     9. Upload ONLY index.html, app.js, logic.js, hr.js, proc.js, templates.js, config.js, logo.jpg and favicon.png.
    10. Open the address it gives you, sign in, go to "Backup and import",
        and choose sterling_import.json from your computer.

UPDATING TO A NEW VERSION
  1. If you are live: run 1_database_setup.sql again in Supabase > SQL Editor. It keeps your data.
  2. Upload the new index.html, app.js, logic.js, hr.js, proc.js, templates.js, logo.jpg and favicon.png. Keep your own config.js.
  3. Reload the page in the browser (Ctrl + F5).
  4. If the page still looks like the old one, the browser is using saved files:
     press Ctrl + F5 again.

STARTING FROM ZERO
  New system: load sterling_import.json. It brings employees only.
  Already loaded the old salary sheets: Backup and import > Start fresh. It removes all
  salary runs and advances and keeps employees, sites and bank details.

FORGOTTEN PASSWORD (set up once)
  The "Forgot password?" link emails a reset link. For it to work:
  1. The system must be on a web address (Cloudflare Pages), not opened as a file.
  2. Supabase > Authentication > URL Configuration:
       Site URL       = your system's address, for example https://sterling-payroll.pages.dev
       Redirect URLs  = add the same address, and the same address followed by /index.html
  Anyone signed in can also use "Change password" in the menu.

EVERY MONTH
  Salary runs > New salary run > pick the site, type the from and to dates.
  Fill days, overtime, advance and deductions. Check the "To check" list.
  Payments > Download payment list > pay > mark the employees in the list as paid.
  Anyone without an account stays pending. Add his account later and pay him then.
  In a run: tick Paid for one employee, press Slip for a payslip.
  Backup and import > Download backup file. Keep it somewhere safe.

ROLES
  admin  can change everything.
  owner  sees Dashboard, Salary runs, Advances, Reports and Change history. Cannot change anything.
         The database itself refuses changes from an owner login.


==========================================================================
UPGRADE TO VERSION 11: HR, SITE ATTENDANCE AND LETTERS
==========================================================================
Payroll works exactly as before. Your employees, salary runs, advances and history are kept.

  1. Supabase > SQL Editor > paste ALL of the new 1_database_setup.sql > Run.
     (Safe to run again at any time. It only adds what is new.)
  2. Cloudflare Pages > your project > Create deployment > upload:
     index.html, app.js, logic.js, hr.js, proc.js, templates.js, config.js, logo.jpg, favicon.png
  3. Open the system and press Ctrl + F5.

ROLES
  Accountant (admin)  everything: payroll, HR, attendance, letters, users.
  Owner               sees dashboards, salary runs, live attendance, the attendance register
                      and the letter register. Cannot change anything.
  HR                  employees (personal and job details), live attendance, attendance register,
                      letters, and site logins. Cannot see or change rates and bank details,
                      and cannot change salary runs. The database itself enforces this.
  Site attendance     one login per site supervisor. After signing in he sees ONLY today's list
                      for his sites and marks P, H (half day), A, L or OT. Nothing else in the system.

GIVE SOMEONE A LOGIN (HR or a site supervisor)
  1. Supabase > Authentication > Users > Add user > Create new user.
     Type an email and password and tick "Auto Confirm User".
     A site supervisor does not need a real email; for example pepsico.site@sterlingengineering.pk.
  2. In the system: Users and access > Refresh. The new login shows "No access yet".
  3. Give access > choose the role. For a site login, tick his sites (a main site includes its teams).
  4. Give him the email and password. He opens the same web address on his phone.
  To stop someone, set Status to Blocked. HR can manage site logins; only the admin can make
  someone HR, Owner or Accountant.

ATTENDANCE RULES (checked by the database, so they cannot be skipped from a phone)
  - A site login can only mark TODAY, by Pakistan time from the server. Never a past or future day.
  - He can only mark workers of his own sites.
  - Same-day correction: he can correct his own marks until midnight. From the next day the day is
    locked for him and only HR can change it. HR can switch this off in Users and access, then a
    mark is locked the moment it is saved.
  - If HR has set a mark, the site login cannot change it.
  - Every mark and every correction is written to a log by the database, with who and when.
    It shows under Activity on the Live attendance screen.

EVERY DAY
  Site supervisors mark attendance on their phones. "Mark N not marked as Present" does the whole
  site at once; then he changes the few who are absent, on leave or on overtime.
  HR watches Live attendance. Each site shows how many are marked and when the last mark came in.
  Click a site to see each person and correct a mark.

SALARY RUN FROM ATTENDANCE
  Open a salary run (with its from and to dates set) > "Fill days and OT from attendance".
  Days = P and OT marks in the period, at that site, plus 0.5 for each H (half day). OT hours = the hours marked.
  Paid lines are never changed. You can still type over any figure as before.

LETTERS
  HR letters > choose the letter > search the employee > check the details > Download Word letter.
  The file is your company letter with the details filled in. Ref numbers continue from
  OL/104, WL/02 and TERM/1002 and can be typed over. Every letter is kept in the register
  and can be downloaded again. A termination letter can also mark the employee as Left.
  Fill father name, CNIC and department in Employees once, and every letter picks them up.

LIVE UPDATES
  The Live attendance screen updates by itself as marks come in. If your network blocks live
  updates, it still checks for new marks every 20 seconds.


==========================================================================
VERSION 12: PROCUREMENT
==========================================================================
Update: run the new 1_database_setup.sql in Supabase > SQL Editor, then upload the 8 files
(index.html, app.js, logic.js, hr.js, proc.js, templates.js, config.js, logo.jpg, favicon.png).

FILE STORAGE (quotations, datasheets, MTC, COC and other documents)
  The SQL creates a private storage bucket named "procurement". Check Supabase > Storage: you should
  see it. If it is not there, press New bucket, name it procurement, leave "Public" OFF, and run the
  SQL file again so it adds the access rules.

ROLES
  Procurement   does the procurement work. Sees only procurement and the list of sites; no payroll,
                no HR, no attendance.
  Owner         sees all procurement and APPROVES or REJECTS purchases. Cannot change anything else.
  Accountant    everything, and can also approve.
  HR and site logins do not see procurement.
  Make a procurement login like any other: Supabase > Authentication > Add user, then
  Users and access > Give access > Procurement (only the admin can do this).

THE PROCESS (one material request goes through six steps)
  1. Request       title, site, project, required date, and the items from the BOQ:
                   description, specification, approved brands, quantity, unit.
                   Technical submittal status and BOQ / drawings can be attached here.
  2. RFQ           add the suppliers to ask (at least three where possible) and download a Word RFQ
                   for each, on the company letterhead, to send by email or WhatsApp.
  3. Quotations    enter each supplier's rates per item, brand offered, tax, transport, delivery,
                   payment terms, warranty, validity, technical compliance and certificates.
                   Other currencies (USD, AED...) are entered with the rate to PKR. Attach the quotation.
  4. Comparison    the comparative statement is built automatically, lowest rate per item in green.
                   Choose the recommended supplier. If it is not the lowest, or not fully compliant,
                   a reason is required. Press Send for approval. (Excel download and print available.)
  5. Approval      the owner or the admin approves or rejects with a note.
                   The database itself refuses approval from anyone else, and refuses a purchase order
                   before approval or from a different quotation than the approved one.
                   Changing the chosen quotation after approval cancels the approval.
  6. Purchase order  issue the PO (number SEC/PO/2026/001 onwards) and download it as Word,
                   with items, tax, total in words, terms and a supplier acceptance block.

AFTER THE PO
  Purchase orders > open the PO:
  - Follow-up: note what the supplier said and the expected date. Late orders are flagged.
  - Record delivery: quantity received and accepted per item, inspection result, and which
    documents came with it (MTC, COC, datasheet, inspection report, warranty, O&M manual).
    Attach the scanned certificates to the delivery. The PO becomes Partly received or Received.
  - Close the order when everything is done.

SUPPLIERS
  Company, category, contact, NTN, brands, payment terms, rating and approved or not.
  Each supplier shows how many quotations and POs it has and how often it delivered on time.

==========================================================================
VERSION 12.1: ROLES PER PERSON, OVERTIME RATE, SCREEN STAYS IN PLACE
==========================================================================
Update: run 1_database_setup.sql, then 2_assign_roles.sql, in Supabase > SQL Editor.
Replace the files in the site folder on GitHub; Cloudflare publishes them by itself.

WHO HAS WHICH ROLE (set by 2_assign_roles.sql)
  haroon.iftikhar@sterlingengineering.pk   Admin        everything, logins, settings, backup
  salik@sterlingengineering.pk             Owner        sees payroll, attendance, letters, procurement;
                                                        approves purchases; changes nothing else
  yaseenwasif509@gmail.com                 Accountant   payroll only: salary runs, payments, advances,
                                                        bank details, employees' pay, sites, reports.
                                                        Reads attendance only to fill salary runs.
  farhan.ali@sterlingengineering.pk        Procurement  procurement only
  hr@sterlingengineering.pk                HR           employees, attendance, letters, site logins
  Each login must exist first in Supabase > Authentication > Users. The second SQL file lists any
  login that is MISSING; create it and run the file again.
  Purchases are approved by the owner or the admin.

OVERTIME RATE
  In a salary run the overtime rate is the day rate divided by 8, filled in automatically (shown in
  grey). If the day rate changes, the overtime rate follows. Type a different rate in the box only
  for a special case; a typed rate is kept. People on a fixed amount per run keep their own rate.

==========================================================================
VERSION 13: PROFILES, TEAM STATUS, FRIENDLY ERROR PAGE
==========================================================================
Update: upload the files to GitHub (new file: profile.js), then run 1_database_setup.sql again.

MY PROFILE (admin, accountant, HR, procurement)
  Click your name at the bottom of the sidebar. Upload a photo, set gender, and set a status:
  Available, Busy, Away or Out of office, with an optional note and a "back on" date.
  After that date the status goes back to Available by itself.

TEAM STATUS (owner and admin)
  Overview > Team status shows everyone's photo, status, note and whether they are online now
  (the system is open on their device) or when they were last seen.

WHEN SOMETHING GOES WRONG
  Instead of technical messages, people see "Sorry for the inconvenience. Please contact the
  developer." with a small line of details for the developer, and a Try again button.
  This shows for: a login with no role or a blocked login, the database not reachable, or a crash.
