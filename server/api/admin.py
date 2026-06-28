from django.contrib import admin
from api.models import User, Chart

@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ('id', 'username', 'display_name', 'credits', 'openid', 'created_at')
    search_fields = ('id', 'username', 'display_name', 'openid')
    ordering = ('-created_at',)

@admin.register(Chart)
class ChartAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'fingerprint', 'label', 'ts')
    search_fields = ('id', 'user__username', 'user__display_name', 'fingerprint', 'label')
    ordering = ('-ts',)
