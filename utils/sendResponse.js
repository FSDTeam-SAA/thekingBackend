const sendResponse = (res, data) => {
  res.status(data?.statusCode).json({
    success: data.success,
    message: data.message,
    pagination: data.pagination || null,
    data: data.data,
  });
};

export default sendResponse;
