-- ============================================================================
-- UPDATE CENTER NAME
-- ============================================================================
-- Run this in the Supabase SQL Editor to set the center's Arabic name.
-- Safe to re-run any time you want to change it later.
-- ============================================================================

update center_settings
set
    center_name = 'سنتر ديار التعليمي',
    center_tagline = 'رحلتك التعليمية تبدأ من هنا. احجز حصصك بسهولة، واختر المواد والمعلمين والمواعيد التي تناسبك.'
where id = 1;
