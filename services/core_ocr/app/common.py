from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, message, status=400, code="ERR_BAD_REQUEST_001"):
        self.message, self.status, self.code = message, status, code


def success(data=None, message="Thành công"):
    return {"success": True, "message": message, "data": data}


def failure(error):
    return JSONResponse(status_code=error.status, content={
        "success": False, "message": error.message,
        "error_code": error.code, "details": None,
    }, headers={"Cache-Control": "no-store"})
