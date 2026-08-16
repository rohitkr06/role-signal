# RoleSignal Browser Companion

This Manifest V3 Chrome extension captures visible job cards for RoleSignal discovery and fills only evidence-backed profile fields and user-verified answer-vault fields from an approved application packet.

## Install locally

1. Extract `rolesignal-browser-companion.zip`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select the extracted folder.
4. For discovery, open a supported portal or company search-results page and choose **Capture visible jobs**. Version 0.5 recognizes LinkedIn, Naukri, Workday, Indeed, Wellfound, Cutshort, Instahyre, Hirist, Foundit, Glassdoor, and YC Jobs.
5. Paste the copied discovery batch into RoleSignal's **Discover jobs** tab.
6. For applications, prepare and approve a job in RoleSignal, then paste its browser packet and choose **Stage supported fields**.

The companion reads only job cards present in the active page, does not paginate or bypass access controls, and never sends portal credentials to RoleSignal. Application fill remains host-locked, flags unknown required fields, never bypasses CAPTCHAs, and never clicks final submit. Version 0.5 also maps recurring phone, portfolio, location, notice-period, compensation, authorization, and relocation fields when those answers were explicitly saved in RoleSignal.
