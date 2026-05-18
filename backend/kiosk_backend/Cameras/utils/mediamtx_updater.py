import paramiko
import yaml
from django.conf import settings
import requests
from requests.auth import HTTPBasicAuth



def update_mediamtx_config(stream_path: str, url: str, old_stream_path: str = None):
    """
    Safely updates MediaMTX YAML file even when 'paths:' exists but is None.
    If 'paths:' is missing or empty, creates it as an empty dict.
    """
    server = settings.MEDIAMTX_SERVER
    host = server["host"]
    username = server["username"]
    password = server["password"]
    config_path = server["config_path"]
    container_name = server.get("docker_container", "mediamtx")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(hostname=host, username=username, password=password)
        sftp = ssh.open_sftp()

        # 1️⃣ Read YAML content safely
        with sftp.open(config_path, "r") as file:
            content = file.read().decode("utf-8")

        try:
            config = yaml.safe_load(content)
        except Exception:
            config = {}

        # 2️⃣ If YAML is empty or not a dict → initialize
        if not isinstance(config, dict):
            config = {}

        # 3️⃣ FIX: If paths is missing OR None OR not dict → reset safely
        if "paths" not in config or not isinstance(config["paths"], dict):
            config["paths"] = {}

        # 4️⃣ If old_stream_path changed, rename it
        if old_stream_path and old_stream_path != stream_path:
            if old_stream_path in config["paths"]:
                config["paths"][stream_path] = config["paths"].pop(old_stream_path)

        # 5️⃣ Add or update stream entry
        config["paths"][stream_path] = {
            "source": url,
            "rtspTransport": "tcp",
            "sourceOnDemand": False,
            "runOnReadyRestart": True,
        }

        # 6️⃣ Write YAML back
        yaml_dump = yaml.dump(config, default_flow_style=False, sort_keys=False)
        with sftp.open(config_path, "w") as file:
            file.write(yaml_dump)
        sftp.close()

        # 7️⃣ Restart Docker container
        stdin, stdout, stderr = ssh.exec_command(f"docker restart {container_name}")
        if stdout.channel.recv_exit_status() != 0:
            err = stderr.read().decode().strip()
            raise Exception(f"Docker restart failed: {err}")

        ssh.close()
        return True, f"Camera path '{stream_path}' added successfully and Docker restarted."

    except Exception as e:
        try:
            ssh.close()
        except:
            pass
        return False, str(e)


def remove_mediamtx_path(stream_path: str):
    """
    Remove a stream path from mediamtx.yml and restart Docker.
    """
    server = settings.MEDIAMTX_SERVER
    host = server["host"]
    username = server["username"]
    password = server["password"]
    config_path = server["config_path"]
    container_name = server["docker_container"]

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(hostname=host, username=username, password=password)
        sftp = ssh.open_sftp()

        # Read YAML
        with sftp.open(config_path, "r") as file:
            content = file.read().decode("utf-8")

        config = yaml.safe_load(content) or {}

        # Remove path
        if "paths" in config and stream_path in config["paths"]:
            del config["paths"][stream_path]

        # Write YAML back
        yaml_dump = yaml.dump(config, default_flow_style=False, sort_keys=False)
        with sftp.open(config_path, "w") as file:
            file.write(yaml_dump)

        sftp.close()

        # Restart Docker container
        stdin, stdout, stderr = ssh.exec_command(f"docker restart {container_name}")
        exit_status = stdout.channel.recv_exit_status()
        if exit_status != 0:
            err = stderr.read().decode()
            raise Exception(f"Docker restart failed: {err}")

        ssh.close()
        return True, "Camera path removed and MediaMTX Docker restarted."

    except Exception as e:
        try:
            ssh.close()
        except:
            pass
        return False, str(e)
def get_all_cameras_status():
    """
    Fetch MediaMTX active paths and return dict:
    {
      "stream_path": {"status": True/False, "viewers": int}
    }
    """
    server = settings.MEDIAMTX_SERVER
    host = server.get("host", "127.0.0.1")
    port = server.get("api_port", 9997)
    username = server.get("api_user", "admin")
    password = server.get("api_pass", "admin")

    url = f"http://{host}:{port}/v3/paths/list"
    cameras = {}

    try:
        response = requests.get(url, auth=HTTPBasicAuth(username, password), timeout=5)
        if response.status_code == 200:
            data = response.json()
            items = data.get("items", [])
            for cam in items:
                name = cam.get("name", "unknown")
                ready = cam.get("ready", False)
                readers = cam.get("readers", [])
                viewer_count = len(readers)
                cameras[name] = {
                    "status": bool(ready),
                    "viewers": viewer_count if ready else 0
                }

        elif response.status_code == 401:
            print("❌ Unauthorized — check your MediaMTX API credentials.")
        else:
            print(f"⚠️ HTTP {response.status_code}: {response.text}")

    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to MediaMTX API — check host/port/firewall.")
    except requests.exceptions.Timeout:
        print("⚠️ MediaMTX API connection timed out.")
    except Exception as e:
        print(f"⚠️ Unexpected error: {e}")

    return cameras


def get_camera_status_by_path(stream_path: str):
    """
    Reuse list API to get specific camera info.
    Returns: {"status": bool, "viewers": int}
    """
    all_status = get_all_cameras_status()
    if stream_path in all_status:
        return all_status[stream_path]
    else:
        return {"status": False, "viewers": 0}
