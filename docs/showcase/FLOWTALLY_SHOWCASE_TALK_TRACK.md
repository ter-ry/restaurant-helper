# Flowtally Showcase Talk Track

## Opening

“Flowtally is not trying to replace the POS. It connects the evidence around the POS—purchases, inventory, recipes, daily close, and owner follow-up—so a restaurant can act before a small variance becomes a large one.”

## Use case 1: purchase review → inventory

“A supplier invoice is not just an attachment. The useful outcome is a reviewable supplier, item, quantity, unit price, and downstream inventory movement. Here the completed rehearsal anchor is Oak Valley Meat Co invoice OV-1041, where Chicken Breast is $7.80. OV-1038 gives us a prior $7.20 reference, so an owner can ask what changed before approving the next purchase.”

If asked whether this is live OCR: “This is a stored completed purchase with a manual extraction status and seeded pilot invoice text. It demonstrates the review and inventory record, not a live OCR capture.”

## Use case 2: Square sale → recipe consumption

“The POS knows the sale. Flowtally needs the mapping that turns a sold variation into the recipe ingredients an operator manages. Here `Harbour Burger · Base` is mapped to Harbour Burger, with one sold unit and theoretical usage for Chicken Breast, Bread Buns, and Lettuce. This controlled Production test order is already imported, and Inventory History contains the corresponding -0.2 kg Chicken Breast consumption movement.”

If Square is unavailable: “The integration status and mapping are the important control points. I’m not going to manufacture or sync a transaction during a production showcase; the existing persisted movement and Usage / Variance record are the safe evidence.”

## Use case 3: owner attention loop

“The owner does not need another dashboard full of numbers. They need to know what deserves attention: a low-stock item, a price change, a review state, or a close exception. Flowtally turns that signal into a reorder, count, or follow-up action.”

## Close

“The through-line is evidence to action: invoice evidence informs inventory, sales inform usage, and exceptions inform the owner’s next decision.”

## Words to avoid

Avoid “fully automated,” “real-time” unless visibly verified, “production Square order” for synthetic records, “accounting sync” where only export is supported, and “OCR is guaranteed.”
