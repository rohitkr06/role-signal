# RoleSignal Browser Companion

This Manifest V3 Chrome extension fills only evidence-backed profile fields and user-verified answer-vault fields from a RoleSignal application packet.

## Install locally

1. Extract `rolesignal-browser-companion.zip`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select the extracted folder.
4. In RoleSignal, prepare and approve an application, then copy its browser packet.
5. Open the official application page, open the extension, paste the packet, and choose **Stage supported fields**.

The companion is intentionally host-locked, flags unknown required fields, never bypasses CAPTCHAs, and never clicks final submit. Version 0.3 maps recurring phone, portfolio, location, notice-period, compensation, authorization, and relocation fields when those answers were explicitly saved in RoleSignal.
