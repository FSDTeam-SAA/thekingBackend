import handleValidationError from "../errors/handleValidationError.js";
import HandleCastError from "../errors/HandleCastError.js";
import handleDuplicateError from "../errors/handleDuplicateError.js";
import AppError from "./../errors/AppError.js";

const globalErrorHandler = (err, req, res, next) => {
  // console.log({ GlobalError: err });
  let statusCode = 500;
  let message = err.message;
  let errorSources = [
    {
      path: "",
      message: err.message,
    },
  ];

  if (err?.name === "ValidationError") {
    const simplifiedError = handleValidationError(err);
    statusCode = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  } else if (err?.name === "CastError") {
    const simplifiedError = HandleCastError(err);
    statusCode = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  } else if (err?.code === 11000) {
    const simplifiedError = handleDuplicateError(err);
    statusCode = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  } else if (err instanceof AppError) {
    statusCode = err?.statusCode;
    message = err.message;
    errorSources = [
      {
        path: "",
        message: err?.message,
      },
    ];
  }

  const response = {
    success: false,
    message,
    errorSources,
    err,
  };

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack.split('\n').map(l => l.trimStart());
  }

  return res.status(statusCode).json(response);
};

export default globalErrorHandler;
