import json
from django.test import TestCase, Client
from django.contrib.auth.hashers import check_password
from api.models import User, Chart

class ApiEndpointsTest(TestCase):
    def setUp(self):
        self.client = Client()

    def test_health_check(self):
        response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

    def test_me_unauthorized(self):
        response = self.client.get('/api/me')
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json().get('user'))
        self.assertFalse(response.json().get('wechat'))

    def test_register_and_login(self):
        # 1. Register a new user
        payload = {
            "username": "testuser",
            "password": "password123"
        }
        response = self.client.post(
            '/api/auth/register',
            data=json.dumps(payload),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        res_data = response.json()
        self.assertIn("user", res_data)
        user_info = res_data["user"]
        self.assertEqual(user_info["username"], "testuser")
        self.assertEqual(user_info["credits"], 10)
        
        # Verify user is in DB
        db_user = User.objects.get(username="testuser")
        self.assertTrue(check_password("password123", db_user.password_hash))

        # 2. Try registering a duplicate user
        response_dup = self.client.post(
            '/api/auth/register',
            data=json.dumps(payload),
            content_type='application/json'
        )
        self.assertEqual(response_dup.status_code, 400)
        self.assertEqual(response_dup.content.decode('utf-8'), "用户名已存在")

        # 3. Log out
        response_logout = self.client.post('/api/auth/logout')
        self.assertEqual(response_logout.status_code, 200)
        self.assertEqual(response_logout.json(), {"ok": True})

        # me should return null user now
        response_me = self.client.get('/api/me')
        self.assertIsNone(response_me.json().get('user'))

        # 4. Log in
        response_login = self.client.post(
            '/api/auth/login',
            data=json.dumps(payload),
            content_type='application/json'
        )
        self.assertEqual(response_login.status_code, 200)
        self.assertEqual(response_login.json()["user"]["username"], "testuser")

        # 5. Log in with incorrect credentials
        payload_wrong = {
            "username": "testuser",
            "password": "wrongpassword"
        }
        response_wrong = self.client.post(
            '/api/auth/login',
            data=json.dumps(payload_wrong),
            content_type='application/json'
        )
        self.assertEqual(response_wrong.status_code, 401)
        self.assertEqual(response_wrong.content.decode('utf-8'), "用户名或密码错误")

    def test_credits_system(self):
        # Register a user
        payload = {
            "username": "credituser",
            "password": "password123"
        }
        self.client.post(
            '/api/auth/register',
            data=json.dumps(payload),
            content_type='application/json'
        )

        # Recharge 5 CNY -> should yield 60 credits (10 default + 50)
        recharge_payload = {"amount": 5.0}
        response = self.client.post(
            '/api/credits/recharge',
            data=json.dumps(recharge_payload),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["credits"], 60)

        # Try negative amount recharge -> should fail with 400
        recharge_bad = {"amount": -10.0}
        response_bad = self.client.post(
            '/api/credits/recharge',
            data=json.dumps(recharge_bad),
            content_type='application/json'
        )
        self.assertEqual(response_bad.status_code, 400)
        self.assertEqual(response_bad.content.decode('utf-8'), "金额必须大于0")

    def test_charts_sync_and_delete(self):
        # Register a user
        payload = {
            "username": "syncuser",
            "password": "password123"
        }
        self.client.post(
            '/api/auth/register',
            data=json.dumps(payload),
            content_type='application/json'
        )

        # Sync a chart
        sync_payload = {
            "charts": [
                {
                    "id": "fp1",
                    "label": "My Test Chart",
                    "chart": {"birth": "1996"},
                    "reading": "Test reading",
                    "ts": 1000
                }
            ]
        }
        response = self.client.post(
            '/api/charts/sync',
            data=json.dumps(sync_payload),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        res_data = response.json()
        self.assertEqual(len(res_data["charts"]), 1)
        self.assertEqual(res_data["charts"][0]["id"], "fp1")
        self.assertEqual(res_data["charts"][0]["reading"], "Test reading")

        # Sync duplicate with smaller ts and null reading -> should preserve larger ts and non-null reading
        sync_payload_older = {
            "charts": [
                {
                    "id": "fp1",
                    "label": "Old Chart name",
                    "chart": {"birth": "1996"},
                    "reading": None,
                    "ts": 500
                }
            ]
        }
        response_older = self.client.post(
            '/api/charts/sync',
            data=json.dumps(sync_payload_older),
            content_type='application/json'
        )
        self.assertEqual(response_older.status_code, 200)
        res_data_older = response_older.json()
        self.assertEqual(res_data_older["charts"][0]["label"], "My Test Chart")  # Preserved newer label
        self.assertEqual(res_data_older["charts"][0]["reading"], "Test reading") # Preserved non-null reading

        # Delete chart
        delete_payload = {"id": "fp1"}
        response_delete = self.client.post(
            '/api/charts/delete',
            data=json.dumps(delete_payload),
            content_type='application/json'
        )
        self.assertEqual(response_delete.status_code, 200)
        self.assertEqual(response_delete.json(), {"ok": True})

        # Fetch charts -> should be empty
        response_get = self.client.get('/api/charts')
        self.assertEqual(len(response_get.json()["charts"]), 0)
