---
"@codeforamerica/blueprint-mock-server": patch
---

The mock started from the command line and the one built in a page are now set up the same way, so a page now fills in a service call's `serviceType`, `callMode` and `status` as the command-line server did, and a server started in the same process as an earlier one no longer answers that server's event stubs. (#516)
