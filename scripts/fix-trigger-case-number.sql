CREATE OR REPLACE FUNCTION core.generate_case_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $body$
DECLARE
  candidate TEXT;
  attempts  INT := 0;
BEGIN
  IF NEW.case_number IS NULL THEN
    LOOP
      candidate := 'EL-' || TO_CHAR(NOW(), 'YYYY') || '-'
                   || LPAD(nextval('core.case_number_seq')::TEXT, 5, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM core.cases WHERE case_number = candidate
      );
      attempts := attempts + 1;
      IF attempts > 50 THEN
        candidate := 'EL-' || TO_CHAR(NOW(), 'YYYY') || '-X'
                     || LPAD(nextval('core.case_number_seq')::TEXT, 6, '0');
        EXIT;
      END IF;
    END LOOP;
    NEW.case_number := candidate;
  END IF;
  RETURN NEW;
END;
$body$;
