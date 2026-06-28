import uuid
from django.db import models

class User(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=uuid.uuid4)
    openid = models.CharField(max_length=255, unique=True, null=True, blank=True)
    username = models.CharField(max_length=255, unique=True, null=True, blank=True)
    password_hash = models.CharField(max_length=255, null=True, blank=True)
    credits = models.IntegerField(default=10)
    unionid = models.CharField(max_length=255, null=True, blank=True)
    display_name = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.BigIntegerField()

    class Meta:
        db_table = 'users'

class Chart(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=uuid.uuid4)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='charts')
    fingerprint = models.CharField(max_length=255)
    label = models.CharField(max_length=255)
    chart_json = models.TextField()
    reading = models.TextField(null=True, blank=True)
    ts = models.BigIntegerField()

    class Meta:
        db_table = 'charts'
        unique_together = ('user', 'fingerprint')
