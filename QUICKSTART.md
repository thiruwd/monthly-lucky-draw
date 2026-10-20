# Connect the lucky-draw app to Supabase

You only need to do this once. The app creates its tables automatically.

1. Open your Supabase project: https://supabase.com/dashboard
2. Click **Connect** at the top, select **Session pooler**, and copy the full **URI** beginning with `postgresql://`. Leave `[YOUR-PASSWORD]` unchanged.
3. In Command Prompt, run:

```cmd
cd /d D:\nodejs\monthly-lucky-draw
npm start
```

4. At **Database URI**, paste the copied URI and press Enter.
5. At **Supabase database password**, enter the database password you chose when creating the Supabase project and press Enter. This is separate from the lucky-draw admin password. Both inputs stay hidden.

When setup succeeds, the app starts automatically.

- Admin page: http://127.0.0.1:3000/admin
- Public wheel: http://127.0.0.1:3000/

Next time, just run `npm start`.

The app includes Supabase's public root certificate automatically. Keep your database password private.

Official connection instructions: https://supabase.com/docs/guides/database/connecting-to-postgres
