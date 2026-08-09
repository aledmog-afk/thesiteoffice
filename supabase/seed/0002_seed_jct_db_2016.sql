-- Seed reference data: JCT Design & Build 2016 Relevant Events / Relevant Matters.
-- Run after 0001_init.sql. Extend with SBC/IC rows later — contract_type on
-- projects already drives which rows the matching pipeline uses.

insert into jct_clause_reference
  (contract_type, clause_ref, category, title, trigger_keywords, notice_requirement, notice_window_description, notice_window_days)
values
  ('jct_db', '2.26.1',  'relevant_event', 'Force majeure',
    array['force majeure','act of god','beyond control'],
    'Contractor to notify as soon as reasonably practicable once effect on completion is apparent',
    'As soon as reasonably practicable', null),

  ('jct_db', '2.26.6',  'relevant_event', 'Employer instruction / variation',
    array['instruction','variation','change order','vo','architect instruction','ei'],
    'Contractor to notify as soon as reasonably practicable',
    'ASAP', null),

  ('jct_db', '2.26.7',  'relevant_event', 'Late instructions/info from Employer',
    array['late information','awaiting instruction','information request','rfi outstanding','no response'],
    'Contractor to notify as soon as reasonably practicable',
    'ASAP', null),

  ('jct_db', '2.26.10', 'relevant_event', 'Exceptionally adverse weather',
    array['weather','storm','flood','extreme heat','exceptionally adverse','rain stopped work'],
    'Contractor to notify as soon as reasonably practicable',
    'ASAP', null),

  ('jct_db', '2.26.13', 'relevant_event', 'Unforeseen ground conditions (if amended in)',
    array['ground conditions','unforeseen','contamination','buried','existing services','utility strike'],
    'Contractor to notify as soon as reasonably practicable',
    'ASAP', null),

  ('jct_db', '4.20.1',  'relevant_matter', 'Employer instruction causing loss/expense',
    array['instruction','variation','additional cost','loss and expense','disruption'],
    'Contractor to notify without delay once loss becomes apparent',
    'Without delay once loss becomes apparent', null),

  ('jct_db', '4.20.2',  'relevant_matter', 'Late information / discrepancy in docs',
    array['discrepancy','late information','conflicting drawings','design query'],
    'Contractor to notify without delay',
    'Without delay', null),

  ('jct_db', '4.20.5',  'relevant_matter', 'Deferment of possession',
    array['possession','deferred possession','site access delay','late access'],
    'Contractor to notify without delay',
    'Without delay', null)
on conflict do nothing;
