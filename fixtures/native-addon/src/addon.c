#include <node_api.h>

static napi_value Add(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  double a, b;
  napi_get_value_double(env, args[0], &a);
  napi_get_value_double(env, args[1], &b);

  napi_value result;
  napi_create_double(env, a + b, &result);
  return result;
}

static napi_value Multiply(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  double a, b;
  napi_get_value_double(env, args[0], &a);
  napi_get_value_double(env, args[1], &b);

  napi_value result;
  napi_create_double(env, a * b, &result);
  return result;
}

static napi_value GetVersion(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_string_utf8(env, "1.0.0", NAPI_AUTO_LENGTH, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor descs[] = {
    { "add", NULL, Add, NULL, NULL, NULL, napi_default, NULL },
    { "multiply", NULL, Multiply, NULL, NULL, NULL, napi_default, NULL },
    { "version", NULL, GetVersion, NULL, NULL, NULL, napi_default, NULL },
  };
  napi_define_properties(env, exports, 3, descs);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
