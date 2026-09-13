# Prospect demo preparation

Complete this checklist 15–30 minutes before a meeting.

- Choose `demo_profiles/casual_restaurant.json`.
- Collect only public menu information; do not request private operational data for the first walkthrough.
- Pick three recognizable menu items and one supplier story.
- Apply the restaurant and location overlay in `demo_profiles/overlays/`.
- Run `flask --app backend.wsgi:app seed-demo --profile casual_restaurant --restaurant-name "Example Restaurant" --location-name "Downtown Toronto" --overlay demo_profiles/overlays/example_prospect.json --reset` against the isolated demo database.
- Verify Dashboard attention items, purchase history, inventory, one menu cost, one count, and Daily Close.
- Rehearse the 15–20 minute script.
- Reset the isolated demo database after the meeting if the next prospect needs a clean story.

Never point this command at production and never use real OAuth tokens or customer records in the profile.

