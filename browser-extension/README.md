# RoleSignal Browser Companion

This Manifest V3 Chrome extension captures visible job cards for RoleSignal discovery and executes approved Phase 7 application packets using only evidence-backed profile fields and user-verified answer-vault fields.

## Install locally

1. Extract `rolesignal-browser-companion.zip`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select the extracted folder.
4. For discovery, open a supported portal or company search-results page and choose **Capture visible jobs**. Version 0.8 recognizes LinkedIn, Naukri, Weekday, Workday, Indeed, Wellfound, Cutshort, Instahyre, Hirist, Foundit, Glassdoor, and YC Jobs.
5. Paste the copied discovery batch into RoleSignal's **Discover jobs** tab.
6. For one-off applications, paste an approved browser packet and choose **Stage supported fields**.
7. For Phase 7, create a connection key in **Assisted Apply**, paste it into the companion’s **Autopilot** tab, and keep Chrome open and signed in.

The companion reads only job cards present in the active page, does not paginate or bypass access controls, and never sends portal credentials to RoleSignal. Application execution remains host-locked, flags unknown required fields, and never bypasses CAPTCHAs. Version 0.8 can upload an approved resume and run guarded fills on compatible Greenhouse, Lever, or Ashby pages; final submission still pauses for the user.
