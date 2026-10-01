-- =====================================================================
-- MBOne — Migration 032: financial classes for Prompt clients
-- Run after 031. ONE block.
-- =====================================================================
--
-- AdvancedMD splits A/R by financial class (1A AUTO, 1L LIEN …). Prompt's
-- A/R Report splits it three ways instead: primary insurance, secondary
-- insurance, patient. These three classes let a Prompt client's A/R sit
-- in the same tables as everyone else's, so every screen — clinic page,
-- Results, the monthly pack — works for them without special cases.
--
-- Codes start with "P-" so they can never collide with an AdvancedMD code.

insert into financial_classes (code, name, sort_order) values
  ('P-PRI'::text, 'PRIMARY INSURANCE (PROMPT)'::text, 900),
  ('P-SEC',       'SECONDARY INSURANCE (PROMPT)',     910),
  ('P-PAT',       'PATIENT (PROMPT)',                 920)
on conflict (code) do nothing;

-- CHECK — expect 3 rows:
-- select code, name from financial_classes where code like 'P-%' order by sort_order;
