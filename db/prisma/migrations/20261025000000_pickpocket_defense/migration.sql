-- What the TARGET brought to a pickpocket roll (THEFT.md §2h): one off the
-- thief's total for each of Keen Hearing, Eagle Eyes and the two Pickpocketing
-- rungs. Defaulted to 0 so every row rolled before this reads as it did.
ALTER TABLE "PickpocketAttempt" ADD COLUMN "defense" INTEGER NOT NULL DEFAULT 0;
