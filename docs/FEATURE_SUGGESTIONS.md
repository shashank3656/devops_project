# Feature Suggestions

Ideas for future enhancements to the InfraGate DevOps portal.

---

## Already Implemented

- **Theme toggle** – Light/dark mode in all UIs
- **Keyboard shortcuts** – User, Admin, DevOps portals
- **Recent requests** – Quick links to recent request IDs
- **Audit trail** – Request timeline in user history and admin
- **Webhook events dropdown** – Replaced checkboxes in admin webhooks
- **Email** – HTML templates, logging, SMTP configuration
- **Forgot/Reset password** – User lookup, email only if user exists, reset link, confirm password, DB update

---

## Suggested Features (by priority)

### High priority

1. **Auto-assignment rules** – Assign requests to DevOps teams based on team/env/cloud
2. **Approval chains** – Multi-step approval (e.g. admin → DevOps lead)
3. **Recurring requests** – Schedule repeat PRs (e.g. weekly config updates)
4. **@mentions in comments** – Notify users when mentioned in request comments

### Medium priority

5. **Request handoff** – Reassign request from one DevOps user to another
6. **Draft sharing** – Share draft with another user before submit
7. **Approval delegation** – Delegate approval to another user when absent
8. **GitHub PR status sync** – Show PR status (open/merged/closed) in request detail

### Lower priority

9. **Request templates** – Pre-defined config presets per team
10. **Bulk add users to team** – Multi-select in admin team members
11. **User detail** – Full user profile in admin with teams, last login
12. **Export** – CSV/JSON export of requests

---

## Implementation notes

- See `docs/ADMIN_FEATURES_SUGGESTIONS.md` for admin-specific ideas
- See `docs/IMPLEMENTATION_PLAN.md` for existing roadmap
- See `docs/TROUBLESHOOTING.md` for password reset and email debugging
