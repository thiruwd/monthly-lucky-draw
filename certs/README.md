# Supabase database root certificate

`supabase-ca-2021.crt` is Supabase's public database root certificate. The app adds it to Node's standard trusted roots and keeps certificate and hostname verification enabled. `SUPABASE_SSL_CA` can override the bundled roots when a custom certificate is needed.

Downloaded over verified HTTPS from the [official certificate endpoint](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt), published in [Supabase's dashboard source](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json).

SHA-256 fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.

Expires April 26, 2031. Follow Supabase's certificate rotation instructions if the database root changes.
