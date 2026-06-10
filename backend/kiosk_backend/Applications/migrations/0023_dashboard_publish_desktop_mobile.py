# Per-viewport publish flags for dashboards (desktop / mobile).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Applications', '0022_sslcertificate'),
    ]

    operations = [
        migrations.AddField(
            model_name='dashboard',
            name='publish_desktop',
            field=models.BooleanField(default=False, help_text='If true, the desktop layout is published to end users'),
        ),
        migrations.AddField(
            model_name='dashboard',
            name='publish_mobile',
            field=models.BooleanField(default=False, help_text='If true, the mobile layout is published to end users'),
        ),
    ]
