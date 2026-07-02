-- Applied to the live DB via webdev_execute_sql; recorded here for history.
-- Round 93: link an actual bank holding back to the reference-catalog row it was
-- opened from. Nullable — manually-added holdings (no catalogue origin) stay null.
-- Provenance only: a catalogue rate change never mutates an existing holding.
ALTER TABLE `bank_instrument_holdings` ADD COLUMN `bankInstrumentId` int;
