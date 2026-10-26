-- ZenFinanceHub Client Portal — job templates
-- Each request blueprint: kind, title, help_text, and question_type/options or consent_type where needed.
-- due_offset_days = days after the job is created that the request falls due.

insert into public.templates (name, service, description, requests) values

('Limited company year-end', 'year_end',
 'Annual accounts and CT600 for a limited company',
 '[
   {"kind":"upload","title":"Bank statements for the full year","help_text":"Every business account, every month up to your year end.","due_offset_days":21},
   {"kind":"upload","title":"Loan and finance agreements","help_text":"Any loans, hire purchase or leases, with the year-end balance.","due_offset_days":21},
   {"kind":"upload","title":"Receipts for equipment or vehicles over £500","help_text":"Anything you bought to keep in the business.","due_offset_days":21},
   {"kind":"question","title":"Value of stock at your year end","question_type":"amount","due_offset_days":21},
   {"kind":"question","title":"Did anyone owe the business money at the year end?","question_type":"text","help_text":"List customer names and amounts, or say none.","due_offset_days":21},
   {"kind":"question","title":"Did the company pay any dividends this year?","question_type":"yes_no","due_offset_days":21},
   {"kind":"question","title":"Did you use your home for business?","question_type":"yes_no","due_offset_days":21},
   {"kind":"question","title":"Anything unusual this year we should know about?","question_type":"text","due_offset_days":21},
   {"kind":"approval","title":"Approve your accounts and corporation tax return","help_text":"We will add this once your accounts are ready."}
 ]'::jsonb),

('Self assessment', 'self_assessment',
 'Personal tax return (SA100)',
 '[
   {"kind":"upload","title":"P60, P45 or final payslips","help_text":"For every job you had in the tax year.","due_offset_days":28},
   {"kind":"question","title":"Did you receive any rental income?","question_type":"yes_no","due_offset_days":28},
   {"kind":"question","title":"Did you receive dividends or savings interest over £500?","question_type":"yes_no","due_offset_days":28},
   {"kind":"upload","title":"Pension contribution statements","help_text":"Only for pensions you pay into personally.","due_offset_days":28},
   {"kind":"question","title":"Total Gift Aid donations in the year","question_type":"amount","due_offset_days":28},
   {"kind":"question","title":"Did you sell any shares, property or crypto?","question_type":"yes_no","due_offset_days":28},
   {"kind":"approval","title":"Approve your tax return","help_text":"We will add this once your return is ready."}
 ]'::jsonb),

('Monthly bookkeeping', 'bookkeeping',
 'Month-end bookkeeping queries',
 '[
   {"kind":"upload","title":"Missing receipts and invoices","help_text":"We will list the ones we need in the job messages.","due_offset_days":7},
   {"kind":"question","title":"Please explain these bank transactions","question_type":"text","due_offset_days":7}
 ]'::jsonb),

('Payroll run', 'payroll',
 'Monthly or weekly payroll',
 '[
   {"kind":"question","title":"Any starters, leavers or pay changes this period?","question_type":"yes_no","due_offset_days":3},
   {"kind":"upload","title":"Hours or timesheets","help_text":"Only for staff paid by the hour.","due_offset_days":3},
   {"kind":"approval","title":"Approve this payroll","help_text":"Check net pay before we submit to HMRC."}
 ]'::jsonb),

('Property income', 'property',
 'Rental income for a landlord or property company',
 '[
   {"kind":"upload","title":"Letting agent statements","due_offset_days":28},
   {"kind":"upload","title":"Mortgage interest statements","due_offset_days":28},
   {"kind":"question","title":"Any repairs or improvements over £1,000?","question_type":"text","help_text":"Tell us what was done and roughly what it cost.","due_offset_days":28},
   {"kind":"upload","title":"Completion statements for any purchase or sale","due_offset_days":28},
   {"kind":"approval","title":"Approve your figures"}
 ]'::jsonb),

('New client onboarding', 'onboarding',
 'ID, address and engagement letter',
 '[
   {"kind":"upload","title":"Photo ID","help_text":"Passport or driving licence, clear photo of the photo page.","due_offset_days":7},
   {"kind":"upload","title":"Proof of address","help_text":"Bank statement or utility bill dated in the last 3 months.","due_offset_days":7},
   {"kind":"question","title":"Previous accountant''s name and email","question_type":"text","help_text":"So we can ask them for your records. Say none if you are new.","due_offset_days":7},
   {"kind":"consent","title":"Accept your engagement letter","consent_type":"engagement_letter","due_offset_days":7}
 ]'::jsonb),

('Business finance application', 'finance_application',
 'Commercial finance brokerage application pack',
 '[
   {"kind":"question","title":"How much funding do you need, and what is it for?","question_type":"text","due_offset_days":5},
   {"kind":"question","title":"Type of finance","question_type":"choice","options":["Business loan","Asset finance","Invoice finance","Commercial mortgage","Not sure yet"],"due_offset_days":5},
   {"kind":"upload","title":"Last 2 years'' accounts","due_offset_days":7},
   {"kind":"upload","title":"Latest management accounts","help_text":"Profit and loss and balance sheet, as recent as possible.","due_offset_days":7},
   {"kind":"upload","title":"Last 6 months'' business bank statements","due_offset_days":7},
   {"kind":"upload","title":"Photo ID for each director","due_offset_days":7},
   {"kind":"consent","title":"Agree to share your information with lenders","consent_type":"lender_share","due_offset_days":7}
 ]'::jsonb),

('Regulated referral', 'regulated_referral',
 'Introduction to an authorised partner firm',
 '[
   {"kind":"question","title":"Briefly, what do you need help with?","question_type":"text","due_offset_days":5},
   {"kind":"consent","title":"Agree to be introduced to our partner firm","consent_type":"regulated_referral","due_offset_days":5}
 ]'::jsonb)

on conflict (name) do nothing;
